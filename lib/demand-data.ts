import type {
  DataSourceHealth,
  DemandSignal,
  MarketCandidate,
} from "./index-engine";

const GECKO_TERMINAL_API = "https://api.geckoterminal.com/api/v2";
const WINDOW_SECONDS = 30 * 60;
const MAX_TRADES_RETURNED = 300;
const MIN_QUALIFIED_BUY_USD = 1;
const MAX_QUALIFIED_BUY_USD_PER_WALLET = 10_000;
const REQUEST_TIMEOUT_MS = 6_000;

type TradeResource = {
  attributes?: {
    tx_hash?: string;
    tx_from_address?: string;
    block_timestamp?: string;
    kind?: string;
    volume_in_usd?: string | number;
    to_token_address?: string;
  };
};

type PoolTradesResponse = {
  data?: TradeResource[];
};

export type DemandBundle = {
  signals: Map<string, DemandSignal>;
  health: DataSourceHealth;
};

export async function fetchDemandSignals(
  candidates: MarketCandidate[],
  now = new Date(),
): Promise<DemandBundle> {
  const startedAt = Date.now();
  const targets = candidates
    .filter((coin) => coin.primaryPoolAddress)
    .slice(0, 5);
  const results = await Promise.allSettled(
    targets.map(async (coin, index) => {
      if (index > 0) await delay(index * 250);
      const response = await fetchWithRetry(
        `${GECKO_TERMINAL_API}/networks/solana/pools/${encodeURIComponent(
          coin.primaryPoolAddress!,
        )}/trades`,
      );
      const payload = (await response.json()) as PoolTradesResponse;
      return summarizePoolTrades(
        coin.tokenAddress,
        payload.data ?? [],
        now,
      );
    }),
  );

  const signals = new Map<string, DemandSignal>();
  const errors: string[] = [];
  results.forEach((result, index) => {
    if (result.status === "fulfilled") {
      signals.set(targets[index].tokenAddress, result.value);
    } else {
      errors.push(
        result.reason instanceof Error
          ? result.reason.message
          : "unknown demand-source error",
      );
    }
  });

  return {
    signals,
    health: {
      name: "geckoterminal-trades",
      role: "demand",
      ok: signals.size > 0,
      discoveryOk: targets.length > 0,
      records: [...signals.values()].reduce(
        (sum, signal) => sum + signal.observedTrades,
        0,
      ),
      latencyMs: Date.now() - startedAt,
      observedAt: now.toISOString(),
      error:
        errors.length > 0
          ? `${errors.length}/${targets.length} pool requests failed: ${errors[0]}`.slice(
              0,
              160,
            )
          : undefined,
    },
  };
}

export function summarizePoolTrades(
  tokenAddress: string,
  resources: TradeResource[],
  now = new Date(),
): DemandSignal {
  const nowSeconds = Math.floor(now.getTime() / 1000);
  const cutoff = nowSeconds - WINDOW_SECONDS;
  const parsed = resources
    .map((resource) => parseTrade(resource))
    .filter((trade): trade is NonNullable<typeof trade> => Boolean(trade))
    .sort((left, right) => right.timestamp - left.timestamp);
  const oldestTimestamp =
    parsed.length > 0 ? parsed[parsed.length - 1].timestamp : null;
  const coverageComplete =
    resources.length < MAX_TRADES_RETURNED ||
    (oldestTimestamp !== null && oldestTimestamp <= cutoff);

  const buysByTransaction = new Map<
    string,
    { wallet: string; amountUsd: number; timestamp: number }
  >();
  for (const trade of parsed) {
    if (
      trade.timestamp < cutoff ||
      trade.timestamp > nowSeconds + 60 ||
      trade.kind !== "buy" ||
      trade.toTokenAddress !== tokenAddress
    ) {
      continue;
    }
    const current = buysByTransaction.get(trade.signature);
    if (!current || trade.amountUsd > current.amountUsd) {
      buysByTransaction.set(trade.signature, {
        wallet: trade.wallet,
        amountUsd: trade.amountUsd,
        timestamp: trade.timestamp,
      });
    }
  }

  const byWallet = new Map<
    string,
    { totalUsd: number; timestamps: number[] }
  >();
  for (const trade of buysByTransaction.values()) {
    const current = byWallet.get(trade.wallet) ?? {
      totalUsd: 0,
      timestamps: [],
    };
    current.totalUsd += trade.amountUsd;
    current.timestamps.push(trade.timestamp);
    byWallet.set(trade.wallet, current);
  }

  let qualifiedBuyUsd = 0;
  let estimatedUsers = 0;
  let filteredWallets = 0;
  for (const activity of byWallet.values()) {
    const maxPerMinute = maximumEventsPerMinute(activity.timestamps);
    const likelyAutomation =
      activity.timestamps.length >= 20 || maxPerMinute >= 8;
    const dustOnly = activity.totalUsd < MIN_QUALIFIED_BUY_USD;
    if (likelyAutomation || dustOnly) {
      filteredWallets += 1;
      continue;
    }
    estimatedUsers += 1;
    qualifiedBuyUsd += Math.min(
      activity.totalUsd,
      MAX_QUALIFIED_BUY_USD_PER_WALLET,
    );
  }

  return {
    tokenAddress,
    grossBuyUsd: [...buysByTransaction.values()].reduce(
      (sum, trade) => sum + trade.amountUsd,
      0,
    ),
    qualifiedBuyUsd,
    observedBuyerWallets: byWallet.size,
    estimatedUsers,
    identityConfidence: coverageComplete ? 0.55 : 0.35,
    coverageComplete,
    observedTrades: buysByTransaction.size,
    filteredWallets,
    source: "geckoterminal-pool-trades",
  };
}

function parseTrade(resource: TradeResource) {
  const attributes = resource.attributes;
  const signature = attributes?.tx_hash?.trim();
  const wallet = attributes?.tx_from_address?.trim();
  const timestamp = Date.parse(attributes?.block_timestamp ?? "") / 1000;
  const amountUsd = Number(attributes?.volume_in_usd);
  const kind = attributes?.kind;
  const toTokenAddress = attributes?.to_token_address?.trim();
  if (
    !signature ||
    !wallet ||
    !Number.isInteger(timestamp) ||
    !Number.isFinite(amountUsd) ||
    amountUsd <= 0 ||
    (kind !== "buy" && kind !== "sell") ||
    !toTokenAddress
  ) {
    return null;
  }
  return {
    signature,
    wallet,
    timestamp,
    amountUsd,
    kind,
    toTokenAddress,
  };
}

function maximumEventsPerMinute(timestamps: number[]) {
  const buckets = new Map<number, number>();
  for (const timestamp of timestamps) {
    const minute = Math.floor(timestamp / 60);
    buckets.set(minute, (buckets.get(minute) ?? 0) + 1);
  }
  return Math.max(0, ...buckets.values());
}

async function fetchWithRetry(url: string) {
  let lastError: unknown;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    try {
      const response = await fetch(url, {
        headers: { Accept: "application/json" },
        signal: controller.signal,
      });
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }
      return response;
    } catch (error) {
      lastError = error;
      if (attempt === 0) await delay(750);
    } finally {
      clearTimeout(timeout);
    }
  }
  throw lastError instanceof Error ? lastError : new Error("request failed");
}

function delay(milliseconds: number) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}
