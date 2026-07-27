#!/usr/bin/env node
import { createHmac, randomBytes } from "node:crypto";

const required = ["HELIUS_API_KEY", "MT5_INGEST_URL", "MT5_INGEST_SECRET"];
for (const key of required) {
  if (!process.env[key]) {
    console.error(`${key} is required`);
    process.exitCode = 1;
    throw new Error("collector configuration is incomplete");
  }
}

const RPC_URL = `https://mainnet.helius-rpc.com/?api-key=${encodeURIComponent(
  process.env.HELIUS_API_KEY,
)}`;
const WS_URL = `wss://mainnet.helius-rpc.com/?api-key=${encodeURIComponent(
  process.env.HELIUS_API_KEY,
)}`;
const dailyTransactionBudget = clamp(
  Number(process.env.HELIUS_DAILY_TRANSACTION_BUDGET ?? 20_000),
  500,
  25_000,
);
const maxTransactionsPerMinute = clamp(
  Number(process.env.HELIUS_MAX_TRANSACTIONS_PER_MINUTE ?? 20),
  5,
  30,
);
const queue = [];
const queuedSignatures = new Set();
const seenSignatures = new Set();
const walletActivity = new Map();
const priceByAddress = new Map();
let subscriptionAddressById = new Map();
let activeAddresses = [];
let socket;
let reconnectDelayMs = 1_000;
let requestsToday = 0;
let budgetDay = dayKey();
let minuteBucket = minuteKey();
let requestsThisMinute = 0;
let processing = false;

await refreshUniverse();
connect();
setInterval(refreshUniverse, 5 * 60_000).unref();
setInterval(refreshPrices, 60_000).unref();

async function refreshUniverse() {
  const response = await fetch(indexUrl(), {
    headers: { Accept: "application/json" },
  });
  if (!response.ok) throw new Error(`Index HTTP ${response.status}`);
  const snapshot = await response.json();
  const nextAddresses = [
    ...new Set(
      (snapshot.constituents ?? [])
        .map((coin) => coin?.tokenAddress)
        .filter((address) => typeof address === "string"),
    ),
  ].slice(0, 5);
  for (const coin of snapshot.constituents ?? []) {
    if (coin?.tokenAddress && Number(coin?.priceUsd) > 0) {
      priceByAddress.set(coin.tokenAddress, Number(coin.priceUsd));
    }
  }
  if (nextAddresses.length !== 5) {
    throw new Error("Index does not currently expose five constituents");
  }
  if (nextAddresses.join(",") !== activeAddresses.join(",")) {
    activeAddresses = nextAddresses;
    if (socket?.readyState === WebSocket.OPEN) {
      socket.close(1000, "constituent refresh");
    }
  }
}

async function refreshPrices() {
  try {
    const response = await fetch(indexUrl(), {
      headers: { Accept: "application/json" },
    });
    if (!response.ok) return;
    const snapshot = await response.json();
    for (const coin of snapshot.constituents ?? []) {
      if (coin?.tokenAddress && Number(coin?.priceUsd) > 0) {
        priceByAddress.set(coin.tokenAddress, Number(coin.priceUsd));
      }
    }
  } catch {
    // Retain the last successful prices.
  }
}

function connect() {
  subscriptionAddressById = new Map();
  const pendingAddressByRequest = new Map();
  socket = new WebSocket(WS_URL);

  socket.addEventListener("open", () => {
    reconnectDelayMs = 1_000;
    activeAddresses.forEach((address, index) => {
      const requestId = index + 1;
      pendingAddressByRequest.set(requestId, address);
      socket.send(
        JSON.stringify({
          jsonrpc: "2.0",
          id: requestId,
          method: "logsSubscribe",
          params: [{ mentions: [address] }, { commitment: "processed" }],
        }),
      );
    });
    console.log(
      `Helius standard WebSocket connected for ${activeAddresses.length} mints.`,
    );
  });

  socket.addEventListener("message", (event) => {
    let message;
    try {
      message = JSON.parse(String(event.data));
    } catch {
      return;
    }
    if (message.id && message.result) {
      const address = pendingAddressByRequest.get(Number(message.id));
      if (address) subscriptionAddressById.set(Number(message.result), address);
      return;
    }
    if (message.method !== "logsNotification") return;
    const value = message.params?.result?.value;
    if (value?.err || !value?.signature) return;
    const tokenAddress = subscriptionAddressById.get(
      Number(message.params?.subscription),
    );
    if (!tokenAddress || queuedSignatures.has(value.signature)) return;
    if (queue.length >= 5_000) {
      const dropped = queue.shift();
      if (dropped) queuedSignatures.delete(dropped.signature);
    }
    queuedSignatures.add(value.signature);
    queue.push({ signature: value.signature, tokenAddress });
    void processQueue();
  });

  socket.addEventListener("close", () => {
    setTimeout(connect, reconnectDelayMs);
    reconnectDelayMs = Math.min(reconnectDelayMs * 2, 30_000);
  });

  socket.addEventListener("error", () => socket.close());
}

async function processQueue() {
  if (processing) return;
  processing = true;
  try {
    while (queue.length > 0) {
      resetBudgetsIfNeeded();
      if (
        requestsToday >= dailyTransactionBudget ||
        requestsThisMinute >= maxTransactionsPerMinute
      ) {
        await delay(2_000);
        continue;
      }
      const next = queue.shift();
      queuedSignatures.delete(next.signature);
      if (seenSignatures.has(next.signature)) continue;
      seenSignatures.add(next.signature);
      requestsToday += 1;
      requestsThisMinute += 1;

      try {
        const transaction = await getTransaction(next.signature);
        const trade = normalizeTransaction(
          transaction,
          next.signature,
          next.tokenAddress,
        );
        if (trade) await ingest([trade]);
      } catch (error) {
        console.error(
          "Transaction observation failed:",
          error instanceof Error ? error.message : String(error),
        );
      }
      if (seenSignatures.size > 50_000) seenSignatures.clear();
    }
  } finally {
    processing = false;
  }
}

async function getTransaction(signature) {
  const response = await fetch(RPC_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: signature,
      method: "getTransaction",
      params: [
        signature,
        {
          commitment: "confirmed",
          encoding: "jsonParsed",
          maxSupportedTransactionVersion: 0,
        },
      ],
    }),
  });
  if (!response.ok) return null;
  const payload = await response.json();
  return payload?.result ?? null;
}

function normalizeTransaction(transaction, signature, tokenAddress) {
  if (!transaction?.meta || transaction.meta.err) return null;
  const accountKeys = transaction.transaction?.message?.accountKeys ?? [];
  const signer = accountKeys.find((account) =>
    typeof account === "object" ? account.signer : false,
  );
  const feePayer =
    typeof signer?.pubkey === "string"
      ? signer.pubkey
      : typeof accountKeys[0] === "string"
        ? accountKeys[0]
        : accountKeys[0]?.pubkey;
  const pre = balancesByOwner(transaction.meta.preTokenBalances, tokenAddress);
  const post = balancesByOwner(transaction.meta.postTokenBalances, tokenAddress);
  const owners = new Set([...pre.keys(), ...post.keys()]);
  const deltas = [...owners]
    .map((owner) => ({
      owner,
      delta: (post.get(owner) ?? 0) - (pre.get(owner) ?? 0),
    }))
    .filter((item) => Math.abs(item.delta) > 0);
  const selected =
    deltas.find((item) => item.owner === feePayer) ??
    deltas.sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta))[0];
  const priceUsd = priceByAddress.get(tokenAddress);
  const timestamp = Number(transaction.blockTime);
  if (!selected || !priceUsd || !Number.isInteger(timestamp)) return null;

  const recent = (walletActivity.get(selected.owner) ?? []).filter(
    (seenAt) => timestamp - seenAt < 60,
  );
  recent.push(timestamp);
  walletActivity.set(selected.owner, recent);
  const botScore = recent.length > 20 ? 0.95 : recent.length > 8 ? 0.65 : 0.2;

  return {
    signature,
    tokenAddress,
    symbol: "UNKNOWN",
    wallet: selected.owner,
    clusterId: selected.owner,
    side: selected.delta > 0 ? "buy" : "sell",
    amountUsd: Math.abs(selected.delta) * priceUsd,
    priceUsd,
    identityConfidence: 0.4,
    botScore,
    source: "helius-standard-wss",
    timestamp,
  };
}

function balancesByOwner(balances, tokenAddress) {
  const result = new Map();
  for (const balance of balances ?? []) {
    if (balance?.mint !== tokenAddress || !balance?.owner) continue;
    const amount = Number(
      balance.uiTokenAmount?.uiAmountString ??
        balance.uiTokenAmount?.uiAmount ??
        0,
    );
    if (Number.isFinite(amount)) {
      result.set(balance.owner, (result.get(balance.owner) ?? 0) + amount);
    }
  }
  return result;
}

async function ingest(trades) {
  const body = JSON.stringify({ trades });
  const response = await fetch(process.env.MT5_INGEST_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...signedHeaders(body, "helius-collector"),
    },
    body,
  });
  if (!response.ok) {
    throw new Error(`Ingest HTTP ${response.status}`);
  }
}

function signedHeaders(body, signerId) {
  const timestamp = Math.floor(Date.now() / 1000);
  const nonce = randomBytes(18).toString("base64url");
  const canonical = `${timestamp}\n${nonce}\n${body}`;
  const signature = createHmac("sha256", process.env.MT5_INGEST_SECRET)
    .update(canonical)
    .digest("base64url");
  return {
    "X-MT5-Signer": signerId,
    "X-MT5-Timestamp": String(timestamp),
    "X-MT5-Nonce": nonce,
    "X-MT5-Signature": signature,
  };
}

function indexUrl() {
  const url = new URL(process.env.MT5_INGEST_URL);
  url.pathname = "/api/index";
  url.search = "";
  return url;
}

function resetBudgetsIfNeeded() {
  const today = dayKey();
  if (today !== budgetDay) {
    budgetDay = today;
    requestsToday = 0;
  }
  const minute = minuteKey();
  if (minute !== minuteBucket) {
    minuteBucket = minute;
    requestsThisMinute = 0;
  }
}

function dayKey() {
  return new Date().toISOString().slice(0, 10);
}

function minuteKey() {
  return new Date().toISOString().slice(0, 16);
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, Number.isFinite(value) ? value : min));
}

function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}
