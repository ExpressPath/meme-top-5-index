#!/usr/bin/env node

import WebSocket from "ws";

const required = ["BIRDEYE_API_KEY", "MT5_INGEST_URL", "MT5_INGEST_SECRET"];
for (const key of required) {
  if (!process.env[key]) {
    console.error(`${key} is required`);
    process.exit(1);
  }
}

const defaultAddresses = [
  "DezXAZ8z7PnrnRJjz3wXBoRgixCa6YYmx3zbB1pPB263",
  "EKpQGSJtjMFqKZ9KQanSqYXRcF8fBopzL3L6f4czhhpj",
  "2zMMhcVQEXDtdE6vsFS7S7D5oUodfJHE8vd1gnBouauv",
  "7GCihgDB8fe6KNjn2MYtkzZcRjQy3t9GHdC8uHYmW2hr",
  "9BB6NFEcjBCtnNLFko2FqVQBq8HHM13kCyYcdQbgpump",
  "6p6xgHyF7AeE6TZkSmFsko444wqoP15icUSqi2jfGiPN",
  "MEW1gQWJ3nEXg2qgERiKu7FAFj79PHvQVREQUzScPP5",
  "ukHH6c7mMyiWCf1b9pnWe25TSpkDDt3H5pQZgZ74J82",
];

const addresses = [
  ...new Set(
    (process.env.MT5_TOKEN_ADDRESSES ?? defaultAddresses.join(","))
      .split(",")
      .map((value) => value.trim())
      .filter(Boolean),
  ),
].slice(0, 100);

const symbolByAddress = new Map();
const walletActivity = new Map();
const queue = [];
let flushTimer;
let retryMs = 1_000;

await connect();

async function connect() {
  const url = `wss://public-api.birdeye.so/socket/solana?x-api-key=${encodeURIComponent(process.env.BIRDEYE_API_KEY)}`;
  const socket = new WebSocket(url, "echo-protocol", {
    headers: { Origin: "https://birdeye.so" },
  });

  socket.on("open", () => {
    retryMs = 1_000;
    console.log(`Connected. Tracking ${addresses.length} Solana tokens.`);
    socket.send(
      JSON.stringify({
        type: "SUBSCRIBE_TXS",
        data: {
          queryType: "complex",
          query: addresses.map((address) => `address = ${address}`).join(" OR "),
          txsType: "swap",
        },
      }),
    );
  });

  socket.on("message", (event) => {
    let message;
    try {
      message = JSON.parse(String(event));
    } catch {
      return;
    }
    if (message.type !== "TXS_DATA") return;
    const trade = normalizeBirdeyeTrade(message.data);
    if (!trade) return;
    queue.push(trade);
    scheduleFlush();
  });

  socket.on("close", () => {
    console.error(`Disconnected. Retrying in ${retryMs / 1000}s.`);
    setTimeout(connect, retryMs);
    retryMs = Math.min(retryMs * 2, 30_000);
  });

  socket.on("error", (event) => {
    console.error("WebSocket error", event.message ?? "unknown");
    socket.close();
  });
}

function normalizeBirdeyeTrade(data) {
  const tokenAddress = data?.tokenAddress;
  const wallet = data?.owner;
  const signature = data?.txHash;
  const side = data?.side;
  const amountUsd = Number(data?.volumeUSD);
  const timestamp = Number(data?.blockUnixTime);
  if (
    !tokenAddress ||
    !wallet ||
    !signature ||
    (side !== "buy" && side !== "sell") ||
    !Number.isFinite(amountUsd) ||
    amountUsd <= 0 ||
    !Number.isInteger(timestamp)
  ) {
    return null;
  }

  const symbol =
    symbolByAddress.get(tokenAddress) ??
    (data?.to?.address === tokenAddress ? data.to.symbol : data?.from?.symbol) ??
    "UNKNOWN";
  symbolByAddress.set(tokenAddress, symbol);

  const recent = (walletActivity.get(wallet) ?? []).filter(
    (seenAt) => timestamp - seenAt < 60,
  );
  recent.push(timestamp);
  walletActivity.set(wallet, recent);

  const likelyAutomation = recent.length > 20;
  return {
    signature,
    tokenAddress,
    symbol,
    wallet,
    clusterId: wallet,
    side,
    amountUsd,
    priceUsd: Number(data?.tokenPrice ?? data?.pricePair ?? 0) || null,
    identityConfidence: 0.55,
    botScore: likelyAutomation ? 0.9 : 0.15,
    source: "birdeye",
    timestamp,
  };
}

function scheduleFlush() {
  if (queue.length >= 50) {
    void flush();
    return;
  }
  clearTimeout(flushTimer);
  flushTimer = setTimeout(flush, 1_000);
}

async function flush() {
  clearTimeout(flushTimer);
  if (queue.length === 0) return;
  const trades = queue.splice(0, 100);
  const response = await fetch(process.env.MT5_INGEST_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.MT5_INGEST_SECRET}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ trades }),
  });
  if (!response.ok) {
    queue.unshift(...trades);
    console.error(`Ingest failed: HTTP ${response.status}`);
    return;
  }
  console.log(`Accepted ${trades.length} trades.`);
}
