import {
  buildSnapshot,
  fallbackCandidates,
  type DemandSignal,
  type MarketCandidate,
} from "../../../lib/index-engine";

const SEED_ADDRESSES = fallbackCandidates.map((coin) => coin.tokenAddress);

type DexPair = {
  chainId?: string;
  pairAddress?: string;
  baseToken?: { address?: string; symbol?: string; name?: string };
  priceUsd?: string;
  txns?: { h1?: { buys?: number; sells?: number } };
  volume?: { h1?: number };
  priceChange?: { h1?: number };
  liquidity?: { usd?: number };
  marketCap?: number;
  fdv?: number;
  info?: { imageUrl?: string };
};

type TokenRef = { chainId?: string; tokenAddress?: string };

export async function GET() {
  const asOf = new Date().toISOString();

  try {
    const [markets, demand] = await Promise.all([
      fetchMarketCandidates(),
      readDemandSignals().catch(() => new Map<string, DemandSignal>()),
    ]);

    const mergedMarkets = new Map(
      fallbackCandidates.map((coin) => [coin.tokenAddress, coin]),
    );
    for (const market of markets) mergedMarkets.set(market.tokenAddress, market);

    const enriched = [...mergedMarkets.values()].map((coin) => ({
      ...coin,
      demand: demand.get(coin.tokenAddress),
    }));
    const snapshot = buildSnapshot(enriched, asOf);
    const hasFiveLiveMarkets =
      markets.filter(
        (coin) => coin.marketCap >= 1_000_000 && coin.liquidityUsd >= 250_000,
      ).length >= 5;

    return Response.json(
      hasFiveLiveMarkets
        ? snapshot
        : {
            ...snapshot,
            isLive: false,
            dataMode: "fallback",
            identityNotice:
              "ライブ市場データが5銘柄に満たないため、一部に検証済みスナップショットを使用",
          },
      {
      headers: {
        "Cache-Control": "public, max-age=10, s-maxage=15, stale-while-revalidate=30",
        "Access-Control-Allow-Origin": "*",
      },
      },
    );
  } catch {
    const snapshot = buildSnapshot(fallbackCandidates, asOf);
    return Response.json(
      {
        ...snapshot,
        isLive: false,
        dataMode: "fallback",
        identityNotice:
          "外部フィードに接続できないため、最後の検証済み研究スナップショットを表示",
      },
      {
        headers: {
          "Cache-Control": "public, max-age=15",
          "Access-Control-Allow-Origin": "*",
        },
      },
    );
  }
}

async function fetchMarketCandidates(): Promise<MarketCandidate[]> {
  const [profilesResponse, boostsResponse] = await Promise.all([
    fetch("https://api.dexscreener.com/token-profiles/latest/v1", {
      headers: { Accept: "application/json" },
    }),
    fetch("https://api.dexscreener.com/token-boosts/top/v1", {
      headers: { Accept: "application/json" },
    }),
  ]);

  const discovered: TokenRef[] = [];
  if (profilesResponse.ok) {
    discovered.push(...((await profilesResponse.json()) as TokenRef[]));
  }
  if (boostsResponse.ok) {
    discovered.push(...((await boostsResponse.json()) as TokenRef[]));
  }

  const addresses = [
    ...new Set([
      ...SEED_ADDRESSES,
      ...discovered
        .filter((item) => item.chainId === "solana" && item.tokenAddress)
        .map((item) => item.tokenAddress as string),
    ]),
  ].slice(0, 30);

  const response = await fetch(
    `https://api.dexscreener.com/tokens/v1/solana/${addresses.join(",")}`,
    { headers: { Accept: "application/json" } },
  );
  if (!response.ok) throw new Error(`DEX Screener returned ${response.status}`);

  const pairs = (await response.json()) as DexPair[];
  const bestByToken = new Map<string, DexPair>();

  for (const pair of pairs) {
    const address = pair.baseToken?.address;
    if (!address || pair.chainId !== "solana") continue;
    const current = bestByToken.get(address);
    if (
      !current ||
      Number(pair.liquidity?.usd ?? 0) >
        Number(current.liquidity?.usd ?? 0)
    ) {
      bestByToken.set(address, pair);
    }
  }

  return [...bestByToken.entries()].map(([tokenAddress, pair]) => ({
    tokenAddress,
    symbol: pair.baseToken?.symbol?.slice(0, 16) || "UNKNOWN",
    name: pair.baseToken?.name?.slice(0, 48) || "Unknown token",
    priceUsd: Number(pair.priceUsd ?? 0),
    marketCap: Number(pair.marketCap ?? pair.fdv ?? 0),
    liquidityUsd: Number(pair.liquidity?.usd ?? 0),
    volumeUsd: Number(pair.volume?.h1 ?? 0),
    buys: Number(pair.txns?.h1?.buys ?? 0),
    sells: Number(pair.txns?.h1?.sells ?? 0),
    changePercent: Number(pair.priceChange?.h1 ?? 0),
    imageUrl: pair.info?.imageUrl,
  }));
}

async function readDemandSignals() {
  const runtimeEnv = await getRuntimeEnv();
  if (!runtimeEnv.DB) return new Map<string, DemandSignal>();

  const cutoff = Math.floor(Date.now() / 1000) - 30 * 60;
  const result = await runtimeEnv.DB.prepare(
    `SELECT
      token_address AS tokenAddress,
      SUM(CASE WHEN side = 'buy' THEN amount_usd ELSE 0 END) AS grossBuyUsd,
      SUM(
        CASE
          WHEN side = 'buy' AND bot_score < 0.5 AND identity_confidence >= 0.65
          THEN MIN(amount_usd, 10000)
          ELSE 0
        END
      ) AS qualifiedBuyUsd,
      COUNT(
        DISTINCT CASE
          WHEN side = 'buy' AND bot_score < 0.5 AND identity_confidence >= 0.65
          THEN cluster_id
          ELSE NULL
        END
      ) AS estimatedUsers,
      AVG(
        CASE
          WHEN side = 'buy' AND bot_score < 0.5
          THEN identity_confidence
          ELSE NULL
        END
      ) AS identityConfidence
    FROM trades
    WHERE timestamp >= ?
    GROUP BY token_address`,
  )
    .bind(cutoff)
    .all<DemandSignal>();

  return new Map(result.results.map((row) => [row.tokenAddress, row]));
}

async function getRuntimeEnv(): Promise<{ DB?: D1Database }> {
  try {
    const workers = await import("cloudflare:workers");
    return workers.env as unknown as { DB?: D1Database };
  } catch {
    return {};
  }
}
