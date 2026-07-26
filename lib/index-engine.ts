export type DemandSignal = {
  tokenAddress: string;
  grossBuyUsd: number;
  qualifiedBuyUsd: number;
  estimatedUsers: number;
  identityConfidence: number;
};

export type MarketCandidate = {
  tokenAddress: string;
  symbol: string;
  name: string;
  priceUsd: number;
  marketCap: number;
  liquidityUsd: number;
  volumeUsd: number;
  buys: number;
  sells: number;
  changePercent: number;
  imageUrl?: string;
  demand?: DemandSignal;
};

export type IndexConstituent = MarketCandidate & {
  rank: number;
  weight: number;
  rankingBuyUsd: number;
  estimatedUsers: number | null;
  identityConfidence: number | null;
  selectionMode: "human-estimate" | "market-proxy";
};

export type IndexSnapshot = {
  name: "Meme Top 5 Index";
  symbol: "MT5";
  currency: "USD";
  value: number;
  changePercent: number;
  asOf: string;
  isLive: boolean;
  dataMode: "live-human-estimate" | "live-market-proxy" | "fallback";
  windowMinutes: number;
  methodologyVersion: "2.0";
  identityNotice: string;
  constituents: IndexConstituent[];
};

const MIN_MARKET_CAP = 1_000_000;
const MIN_LIQUIDITY = 250_000;
const MIN_ESTIMATED_USERS = 25;
const MIN_IDENTITY_CONFIDENCE = 0.65;

export function buildSnapshot(
  candidates: MarketCandidate[],
  asOf = new Date().toISOString(),
): IndexSnapshot {
  const liquid = candidates.filter(
    (coin) =>
      Number.isFinite(coin.marketCap) &&
      coin.marketCap >= MIN_MARKET_CAP &&
      coin.liquidityUsd >= MIN_LIQUIDITY &&
      coin.priceUsd > 0,
  );

  const identityReady = liquid.filter(
    (coin) =>
      coin.demand &&
      coin.demand.estimatedUsers >= MIN_ESTIMATED_USERS &&
      coin.demand.identityConfidence >= MIN_IDENTITY_CONFIDENCE,
  );

  const useIdentity = identityReady.length >= 5;
  const ranked = [...(useIdentity ? identityReady : liquid)]
    .sort((a, b) => {
      const aScore = useIdentity
        ? a.demand?.qualifiedBuyUsd ?? 0
        : proxyBuyVolume(a);
      const bScore = useIdentity
        ? b.demand?.qualifiedBuyUsd ?? 0
        : proxyBuyVolume(b);
      return bScore - aScore;
    })
    .slice(0, 5);

  const totalMarketCap = ranked.reduce((sum, coin) => sum + coin.marketCap, 0);
  const constituents = ranked.map((coin, index) => {
    const weight = totalMarketCap > 0 ? coin.marketCap / totalMarketCap : 0;
    return {
      ...coin,
      rank: index + 1,
      weight,
      rankingBuyUsd: useIdentity
        ? coin.demand?.qualifiedBuyUsd ?? 0
        : proxyBuyVolume(coin),
      estimatedUsers: useIdentity ? coin.demand?.estimatedUsers ?? null : null,
      identityConfidence: useIdentity
        ? coin.demand?.identityConfidence ?? null
        : null,
      selectionMode: useIdentity
        ? ("human-estimate" as const)
        : ("market-proxy" as const),
    };
  });

  const changePercent = constituents.reduce(
    (sum, coin) => sum + coin.weight * coin.changePercent,
    0,
  );

  return {
    name: "Meme Top 5 Index",
    symbol: "MT5",
    currency: "USD",
    value: 1000 * (1 + changePercent / 100),
    changePercent,
    asOf,
    isLive: constituents.length === 5,
    dataMode: useIdentity
      ? "live-human-estimate"
      : constituents.length === 5
        ? "live-market-proxy"
        : "fallback",
    windowMinutes: useIdentity ? 30 : 60,
    methodologyVersion: "2.0",
    identityNotice: useIdentity
      ? "Bot除外と高信頼クラスタリングを通過した推定ユニーク購入者を使用"
      : "価格・時価総額はライブ。人間推定データ未接続のため、選定は買い出来高プロキシ",
    constituents,
  };
}

function proxyBuyVolume(coin: MarketCandidate) {
  const trades = coin.buys + coin.sells;
  return trades > 0 ? coin.volumeUsd * (coin.buys / trades) : 0;
}

export const fallbackCandidates: MarketCandidate[] = [
  ["DezXAZ8z7PnrnRJjz3wXBoRgixCa6YYmx3zbB1pPB263", "BONK", "Bonk", 0.000014, 1_000_000_000, 2_500_000, 35_000_000, 1200, 950, 1.7],
  ["EKpQGSJtjMFqKZ9KQanSqYXRcF8fBopzL3L6f4czhhpj", "WIF", "dogwifhat", 0.62, 620_000_000, 9_000_000, 42_000_000, 1500, 1400, -0.8],
  ["2zMMhcVQEXDtdE6vsFS7S7D5oUodfJHE8vd1gnBouauv", "PENGU", "Pudgy Penguins", 0.0064, 400_000_000, 3_100_000, 18_000_000, 980, 810, 2.1],
  ["7GCihgDB8fe6KNjn2MYtkzZcRjQy3t9GHdC8uHYmW2hr", "POPCAT", "Popcat", 0.044, 43_000_000, 2_900_000, 8_000_000, 620, 570, 0.4],
  ["9BB6NFEcjBCtnNLFko2FqVQBq8HHM13kCyYcdQbgpump", "FARTCOIN", "Fartcoin", 0.31, 310_000_000, 6_500_000, 21_000_000, 1100, 990, -1.3],
].map(
  ([tokenAddress, symbol, name, priceUsd, marketCap, liquidityUsd, volumeUsd, buys, sells, changePercent]) => ({
    tokenAddress: String(tokenAddress),
    symbol: String(symbol),
    name: String(name),
    priceUsd: Number(priceUsd),
    marketCap: Number(marketCap),
    liquidityUsd: Number(liquidityUsd),
    volumeUsd: Number(volumeUsd),
    buys: Number(buys),
    sells: Number(sells),
    changePercent: Number(changePercent),
  }),
);

export const fallbackSnapshot = buildSnapshot(
  fallbackCandidates,
  "2026-07-26T00:00:00.000Z",
);
