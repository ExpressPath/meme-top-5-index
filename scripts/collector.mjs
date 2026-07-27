#!/usr/bin/env node

const required = ["BIRDEYE_API_KEY", "MT5_INGEST_URL", "MT5_INGEST_SECRET"];
for (const key of required) {
  if (!process.env[key]) {
    console.error(`${key} is required`);
    process.exit(1);
  }
}

const defaultAddresses = [
  "6p6xgHyF7AeE6TZkSmFsko444wqoP15icUSqi2jfGiPN",
  "EKpQGSJtjMFqKZ9KQanSqYXRcF8fBopzLHYxdM65zcjm",
  "2zMMhcVQEXDtdE6vsFS7S7D5oUodfJHE8vd1gnBouauv",
  "7GCihgDB8fe6KNjn2MYtkzZcRjQy3t9GHdC8uHYmW2hr",
  "9BB6NFEcjBCtnNLFko2FqVQBq8HHM13kCyYcdQbgpump",
  "MEW1gQWJ3nEXg2qgERiKu7FAFj79PHvQVREQUzScPP5",
  "ukHH6c7mMyiWCf1b9pnWe25TSpkDDt3H5pQZgZ74J82",
];

const configuredAddresses = parseAddresses(process.env.MT5_TOKEN_ADDRESSES);
const pollIntervalMs = clamp(
  Number(process.env.BIRDEYE_POLL_INTERVAL_MS ?? 600_000),
  300_000,
  3_600_000,
);
const dailyRequestBudget = clamp(
  Number(process.env.BIRDEYE_DAILY_REQUEST_BUDGET ?? 800),
  50,
  900,
);
const seenSignatures = new Set();
const walletActivity = new Map();
let budgetDay = dayKey();
let requestsToday = 0;

console.log(
  `Birdeye Standard REST collector started. Interval ${Math.round(
    pollIntervalMs / 60_000,
  )}m; daily request budget ${dailyRequestBudget}.`,
);

for (;;) {
  try {
    await collectCycle();
  } catch (error) {
    console.error(
      "Collector cycle failed:",
      error instanceof Error ? error.message : String(error),
    );
  }
  await delay(pollIntervalMs);
}

async function collectCycle() {
  resetBudgetIfNeeded();
  const addresses =
    configuredAddresses.length > 0
      ? configuredAddresses
      : await currentConstituentAddresses();
  const targets =
    addresses.length > 0 ? addresses.slice(0, 5) : defaultAddresses.slice(0, 5);
  const afterTime = Math.floor(Date.now() / 1000) - 30 * 60;
  const trades = [];
  let completeTargets = 0;

  for (const address of targets) {
    if (requestsToday >= dailyRequestBudget) {
      console.error("Daily Birdeye request budget reached; collection paused.");
      break;
    }
    requestsToday += 1;
    const response = await fetch(
      `https://public-api.birdeye.so/defi/v3/token/txs?address=${encodeURIComponent(
        address,
      )}&limit=100&sort_by=block_unix_time&sort_type=desc&tx_type=swap&after_time=${afterTime}`,
      {
        headers: {
          Accept: "application/json",
          "X-API-KEY": process.env.BIRDEYE_API_KEY,
          "x-chain": "solana",
        },
      },
    );
    if (!response.ok) {
      console.error(`Birdeye ${address}: HTTP ${response.status}`);
      if (response.status === 429) break;
      continue;
    }
    const payload = await response.json();
    const items = extractItems(payload);
    if (items.length < 100) completeTargets += 1;
    for (const item of items) {
      const trade = normalizeBirdeyeTrade(item, address);
      if (!trade || seenSignatures.has(trade.signature)) continue;
      seenSignatures.add(trade.signature);
      trades.push(trade);
    }
  }

  if (seenSignatures.size > 20_000) seenSignatures.clear();
  if (trades.length > 0) await flushTrades(trades);
  console.log(
    JSON.stringify({
      collectedAt: new Date().toISOString(),
      targets: targets.length,
      completeTargets,
      acceptedTrades: trades.length,
      requestsToday,
      identityMode: "wallet-level-unverified",
      publishableHumanEstimate: false,
    }),
  );
}

async function currentConstituentAddresses() {
  try {
    const indexUrl = new URL(process.env.MT5_INGEST_URL);
    indexUrl.pathname = "/api/index";
    indexUrl.search = "";
    const response = await fetch(indexUrl, {
      headers: { Accept: "application/json" },
    });
    if (!response.ok) return [];
    const snapshot = await response.json();
    return Array.isArray(snapshot.constituents)
      ? snapshot.constituents
          .map((coin) => coin?.tokenAddress)
          .filter((address) => typeof address === "string")
      : [];
  } catch {
    return [];
  }
}

function normalizeBirdeyeTrade(data, requestedAddress) {
  const signature = stringFrom(
    data?.tx_hash,
    data?.txHash,
    data?.signature,
  );
  const wallet = stringFrom(
    data?.owner,
    data?.wallet,
    Array.isArray(data?.signers) ? data.signers[0] : "",
  );
  const timestamp = integerFrom(
    data?.block_unix_time,
    data?.blockUnixTime,
    data?.timestamp,
  );
  const tokenAddress = stringFrom(
    data?.token_address,
    data?.tokenAddress,
    requestedAddress,
  );
  const side = normalizeSide(data?.side, data, requestedAddress);
  const amountUsd = numberFrom(
    data?.volume_usd,
    data?.volumeUSD,
    data?.value_usd,
  );
  if (
    !signature ||
    !wallet ||
    !timestamp ||
    !tokenAddress ||
    !side ||
    amountUsd <= 0
  ) {
    return null;
  }

  const recent = (walletActivity.get(wallet) ?? []).filter(
    (seenAt) => timestamp - seenAt < 60,
  );
  recent.push(timestamp);
  walletActivity.set(wallet, recent);
  const likelyAutomation = recent.length > 20;

  return {
    signature,
    tokenAddress,
    symbol: stringFrom(
      data?.token_symbol,
      data?.symbol,
      data?.to?.symbol,
      data?.from?.symbol,
      "UNKNOWN",
    ).slice(0, 16),
    wallet,
    clusterId: wallet,
    side,
    amountUsd,
    priceUsd:
      numberFrom(data?.token_price, data?.tokenPrice, data?.price) || null,
    identityConfidence: 0.4,
    botScore: likelyAutomation ? 0.95 : 0.2,
    source: "birdeye-standard-rest",
    timestamp,
  };
}

async function flushTrades(trades) {
  for (let index = 0; index < trades.length; index += 100) {
    const batch = trades.slice(index, index + 100);
    const response = await fetch(process.env.MT5_INGEST_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${process.env.MT5_INGEST_SECRET}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ trades: batch }),
    });
    if (!response.ok) {
      throw new Error(`Ingest failed: HTTP ${response.status}`);
    }
  }
}

function extractItems(payload) {
  const candidates = [
    payload?.data?.items,
    payload?.data,
    payload?.items,
    payload?.result,
  ];
  return candidates.find(Array.isArray) ?? [];
}

function normalizeSide(value, data, requestedAddress) {
  const direct = String(value ?? "").toLowerCase();
  if (direct === "buy" || direct === "sell") return direct;
  const toAddress = stringFrom(data?.to?.address, data?.to_address);
  const fromAddress = stringFrom(data?.from?.address, data?.from_address);
  if (toAddress === requestedAddress) return "buy";
  if (fromAddress === requestedAddress) return "sell";
  return null;
}

function parseAddresses(value) {
  return [
    ...new Set(
      String(value ?? "")
        .split(",")
        .map((address) => address.trim())
        .filter(Boolean),
    ),
  ];
}

function stringFrom(...values) {
  const value = values.find(
    (candidate) => typeof candidate === "string" && candidate.trim(),
  );
  return typeof value === "string" ? value.trim() : "";
}

function numberFrom(...values) {
  for (const value of values) {
    const number = Number(value);
    if (Number.isFinite(number)) return number;
  }
  return 0;
}

function integerFrom(...values) {
  const number = numberFrom(...values);
  return Number.isInteger(number) && number > 0 ? number : 0;
}

function resetBudgetIfNeeded() {
  const today = dayKey();
  if (today !== budgetDay) {
    budgetDay = today;
    requestsToday = 0;
  }
}

function dayKey() {
  return new Date().toISOString().slice(0, 10);
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, Number.isFinite(value) ? value : min));
}

function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}
