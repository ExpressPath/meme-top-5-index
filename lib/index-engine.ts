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
  buyerWallets30m?: number | null;
  marketSources?: string[];
  priceDivergenceBps?: number | null;
  marketCapDivergenceBps?: number | null;
  marketConfidence?: number;
  onchainVerified?: boolean;
  onchainSupply?: string | null;
  onchainDecimals?: number | null;
  mintAuthorityRevoked?: boolean;
  freezeAuthorityRevoked?: boolean;
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
  methodologyVersion: "3.0";
  identityNotice: string;
  publication: {
    state: "publishable" | "degraded" | "halted";
    tokenNavEligible: boolean;
    sourceQuorum: number;
    consensusConstituents: number;
    chainVerifiedConstituents: number;
    safeAuthorityConstituents: number;
    reasons: string[];
  };
  dataSources: DataSourceHealth[];
  constituents: IndexConstituent[];
};

export type DataSourceHealth = {
  name: "dexscreener" | "geckoterminal" | "helius-rpc";
  role: "market" | "chain";
  ok: boolean;
  discoveryOk: boolean;
  records: number;
  latencyMs: number;
  observedAt: string;
  error?: string;
};

const MIN_MARKET_CAP = 1_000_000;
const MIN_LIQUIDITY = 250_000;
const MIN_ESTIMATED_USERS = 25;
const MIN_IDENTITY_CONFIDENCE = 0.65;
const MIN_MARKET_CONFIDENCE = 0.65;
const MAX_PRICE_DIVERGENCE_BPS = 500;
const MAX_MARKET_CAP_DIVERGENCE_BPS = 2_500;

export function buildSnapshot(
  candidates: MarketCandidate[],
  asOf = new Date().toISOString(),
  dataSources: DataSourceHealth[] = [],
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
  const consensusReady = liquid.filter(
    (coin) =>
      (coin.marketSources?.length ?? 0) >= 2 &&
      (coin.priceDivergenceBps ?? Number.POSITIVE_INFINITY) <=
        MAX_PRICE_DIVERGENCE_BPS &&
      (coin.marketCapDivergenceBps ?? Number.POSITIVE_INFINITY) <=
        MAX_MARKET_CAP_DIVERGENCE_BPS &&
      (coin.marketConfidence ?? 0) >= MIN_MARKET_CONFIDENCE,
  );
  const rankingUniverse =
    useIdentity && identityReady.length >= 5
      ? identityReady
      : consensusReady.length >= 5
        ? consensusReady
        : liquid;
  const ranked = [...rankingUniverse]
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
  const consensusConstituents = constituents.filter(
    (coin) =>
      (coin.marketSources?.length ?? 0) >= 2 &&
      (coin.priceDivergenceBps ?? Number.POSITIVE_INFINITY) <=
        MAX_PRICE_DIVERGENCE_BPS &&
      (coin.marketCapDivergenceBps ?? Number.POSITIVE_INFINITY) <=
        MAX_MARKET_CAP_DIVERGENCE_BPS &&
      (coin.marketConfidence ?? 0) >= MIN_MARKET_CONFIDENCE,
  ).length;
  const healthySources = dataSources.filter(
    (source) => source.role === "market" && source.ok,
  ).length;
  const chainVerifiedConstituents = constituents.filter(
    (coin) => coin.onchainVerified,
  ).length;
  const safeAuthorityConstituents = constituents.filter(
    (coin) => coin.mintAuthorityRevoked && coin.freezeAuthorityRevoked,
  ).length;
  const reasons: string[] = [];
  if (constituents.length < 5) {
    reasons.push("採用基準を満たす銘柄が5つ未満です");
  }
  if (healthySources < 2) {
    reasons.push("独立した市場データ源が2系統そろっていません");
  }
  if (consensusConstituents < 5) {
    reasons.push("5銘柄すべての価格合意を確認できていません");
  }
  if (!useIdentity) {
    reasons.push("人物単位の推定買いデータが基準未達です");
  }
  if (chainVerifiedConstituents < 5) {
    reasons.push("5銘柄すべてのMintをオンチェーン検証できていません");
  }
  if (safeAuthorityConstituents < 5) {
    reasons.push("追加発行・凍結権限が残る銘柄を検出しました");
  }
  const sourceQuorumReady = healthySources >= 2 && consensusConstituents === 5;
  const tokenNavEligible =
    constituents.length === 5 &&
    sourceQuorumReady &&
    useIdentity &&
    chainVerifiedConstituents === 5 &&
    safeAuthorityConstituents === 5;
  const publicationState =
    constituents.length < 5 || healthySources === 0
      ? ("halted" as const)
      : tokenNavEligible
        ? ("publishable" as const)
        : ("degraded" as const);

  return {
    name: "Meme Top 5 Index",
    symbol: "MT5",
    currency: "USD",
    value: 1000 * (1 + changePercent / 100),
    changePercent,
    asOf,
    isLive: constituents.length === 5 && healthySources > 0,
    dataMode: useIdentity
      ? "live-human-estimate"
      : constituents.length === 5
        ? "live-market-proxy"
        : "fallback",
    windowMinutes: useIdentity ? 30 : 60,
    methodologyVersion: "3.0",
    identityNotice: useIdentity
      ? "Bot除外と高信頼クラスタリングを通過した推定ユニーク購入者を使用"
      : "価格・時価総額は複数ソース照合済み。人物推定データが未達のため順位は買い出来高プロキシ",
    publication: {
      state: publicationState,
      tokenNavEligible,
      sourceQuorum: healthySources,
      consensusConstituents,
      chainVerifiedConstituents,
      safeAuthorityConstituents,
      reasons,
    },
    dataSources,
    constituents,
  };
}

function proxyBuyVolume(coin: MarketCandidate) {
  const trades = coin.buys + coin.sells;
  return trades > 0 ? coin.volumeUsd * (coin.buys / trades) : 0;
}

export const fallbackCandidates: MarketCandidate[] = [
  ["6p6xgHyF7AeE6TZkSmFsko444wqoP15icUSqi2jfGiPN", "TRUMP", "Official Trump", 1.58, 316_000_000, 27_000_000, 18_000_000, 1600, 1450, 0.7],
  ["EKpQGSJtjMFqKZ9KQanSqYXRcF8fBopzLHYxdM65zcjm", "WIF", "dogwifhat", 0.16, 159_000_000, 4_200_000, 9_000_000, 1500, 1400, -0.8],
  ["2zMMhcVQEXDtdE6vsFS7S7D5oUodfJHE8vd1gnBouauv", "PENGU", "Pudgy Penguins", 0.0064, 400_000_000, 3_100_000, 18_000_000, 980, 810, 2.1],
  ["7GCihgDB8fe6KNjn2MYtkzZcRjQy3t9GHdC8uHYmW2hr", "POPCAT", "Popcat", 0.044, 43_000_000, 2_900_000, 8_000_000, 620, 570, 0.4],
  ["9BB6NFEcjBCtnNLFko2FqVQBq8HHM13kCyYcdQbgpump", "FARTCOIN", "Fartcoin", 0.31, 310_000_000, 6_500_000, 21_000_000, 1100, 990, -1.3],
  ["MEW1gQWJ3nEXg2qgERiKu7FAFj79PHvQVREQUzScPP5", "MEW", "cat in a dogs world", 0.00037, 33_000_000, 7_000_000, 5_000_000, 740, 680, 0.6],
  ["ukHH6c7mMyiWCf1b9pnWe25TSpkDDt3H5pQZgZ74J82", "BOME", "BOOK OF MEME", 0.00051, 35_000_000, 9_800_000, 12_000_000, 820, 760, 1.1],
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
