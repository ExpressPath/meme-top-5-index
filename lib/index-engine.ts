export type DemandSignal = {
  tokenAddress: string;
  grossBuyUsd: number;
  qualifiedBuyUsd: number;
  observedBuyerWallets: number;
  estimatedUsers: number;
  identityConfidence: number;
  coverageComplete: boolean;
  observedTrades: number;
  filteredWallets: number;
  source: string;
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
  buyVolumeUsd30m?: number | null;
  primaryPoolAddress?: string;
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
  observedBuyerWallets: number | null;
  estimatedUsers: number | null;
  identityConfidence: number | null;
  demandCoverageComplete: boolean | null;
  demandSource: string | null;
  selectionMode: "human-estimate" | "wallet-observation" | "market-proxy";
};

export type IndexSnapshot = {
  name: "Meme Top 5 Index";
  symbol: "MT5";
  currency: "USD";
  value: number;
  changePercent: number;
  asOf: string;
  isLive: boolean;
  dataMode:
    | "live-human-estimate"
    | "live-wallet-observation"
    | "live-market-proxy"
    | "fallback";
  windowMinutes: number;
  methodologyVersion: "4.0";
  weighting: {
    scheme: "capped-float-market-cap";
    maximumConstituentWeight: number;
    continuity: "divisor";
  };
  identityNotice: string;
  publication: {
    state: "publishable" | "degraded" | "halted";
    tokenNavEligible: boolean;
    sourceQuorum: number;
    consensusConstituents: number;
    chainVerifiedConstituents: number;
    safeAuthorityConstituents: number;
    demandObservedConstituents: number;
    completeDemandConstituents: number;
    reasons: string[];
  };
  dataSources: DataSourceHealth[];
  constituents: IndexConstituent[];
};

export type DataSourceHealth = {
  name:
    | "dexscreener"
    | "geckoterminal"
    | "geckoterminal-trades"
    | "jupiter-price"
    | "helius-rpc"
    | "solana-rpc"
    | "solana-rpc-demand-poll";
  role: "market" | "chain" | "demand";
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
      coin.demand.identityConfidence >= MIN_IDENTITY_CONFIDENCE &&
      coin.demand.coverageComplete,
  );
  const observationReady = liquid.filter(
    (coin) =>
      coin.demand &&
      coin.demand.observedBuyerWallets > 0 &&
      coin.demand.grossBuyUsd > 0,
  );
  const consensusReady = liquid.filter(hasMarketConsensus);
  const useIdentity = identityReady.length >= 5;
  const useWalletObservation = !useIdentity && observationReady.length >= 5;
  const rankingUniverse = useIdentity
    ? identityReady
    : useWalletObservation
      ? observationReady
      : consensusReady.length >= 5
        ? consensusReady
        : liquid;

  const ranked = [...rankingUniverse]
    .sort((left, right) => {
      const leftScore = rankingBuyUsd(
        left,
        useIdentity,
        useWalletObservation,
      );
      const rightScore = rankingBuyUsd(
        right,
        useIdentity,
        useWalletObservation,
      );
      if (rightScore !== leftScore) return rightScore - leftScore;
      return (
        (right.demand?.observedBuyerWallets ?? 0) -
        (left.demand?.observedBuyerWallets ?? 0)
      );
    })
    .slice(0, 5);

  const weights = cappedMarketWeights(
    ranked.map((coin) => coin.marketCap),
    MAX_CONSTITUENT_WEIGHT,
  );
  const selectionMode = useIdentity
    ? ("human-estimate" as const)
    : useWalletObservation
      ? ("wallet-observation" as const)
      : ("market-proxy" as const);
  const constituents = ranked.map((coin, index): IndexConstituent => ({
    ...coin,
    rank: index + 1,
    weight: weights[index] ?? 0,
    rankingBuyUsd: rankingBuyUsd(
      coin,
      useIdentity,
      useWalletObservation,
    ),
    observedBuyerWallets:
      coin.demand?.observedBuyerWallets ?? coin.buyerWallets30m ?? null,
    estimatedUsers:
      coin.demand && coin.demand.estimatedUsers > 0
        ? coin.demand.estimatedUsers
        : null,
    identityConfidence:
      coin.demand && coin.demand.identityConfidence > 0
        ? coin.demand.identityConfidence
        : null,
    demandCoverageComplete: coin.demand?.coverageComplete ?? null,
    demandSource: coin.demand?.source ?? null,
    selectionMode,
  }));

  const changePercent = constituents.reduce(
    (sum, coin) => sum + coin.weight * coin.changePercent,
    0,
  );
  const consensusConstituents =
    constituents.filter(hasMarketConsensus).length;
  const healthyMarketSources = dataSources.filter(
    (source) => source.role === "market" && source.ok,
  ).length;
  const chainVerifiedConstituents = constituents.filter(
    (coin) => coin.onchainVerified,
  ).length;
  const safeAuthorityConstituents = constituents.filter(
    (coin) => coin.mintAuthorityRevoked && coin.freezeAuthorityRevoked,
  ).length;
  const demandObservedConstituents = constituents.filter(
    (coin) => (coin.observedBuyerWallets ?? 0) > 0,
  ).length;
  const completeDemandConstituents = constituents.filter(
    (coin) => coin.demandCoverageComplete,
  ).length;

  const reasons: string[] = [];
  if (constituents.length < 5) {
    reasons.push("採用基準を満たす銘柄が5つ未満です");
  }
  if (healthyMarketSources < 2) {
    reasons.push("独立した市場データ源が2系統そろっていません");
  }
  if (consensusConstituents < 5) {
    reasons.push("5銘柄すべての価格・時価総額合意を確認できていません");
  }
  if (demandObservedConstituents < 5) {
    reasons.push("5銘柄すべての直近30分の買い手観測がそろっていません");
  }
  if (completeDemandConstituents < 5) {
    reasons.push("一部の買い手データは直近300取引による下限値です");
  }
  if (!useIdentity) {
    reasons.push(
      "人物単位を確定できないため、推定アクティブ買い手はウォレット由来の参考値です",
    );
  }
  if (chainVerifiedConstituents < 5) {
    reasons.push("5銘柄すべてのMintをオンチェーン検証できていません");
  }
  if (safeAuthorityConstituents < 5) {
    reasons.push("追加発行・凍結権限が残る銘柄を検出しました");
  }

  const tokenNavEligible =
    constituents.length === 5 &&
    healthyMarketSources >= 2 &&
    consensusConstituents === 5 &&
    useIdentity &&
    completeDemandConstituents === 5 &&
    chainVerifiedConstituents === 5 &&
    safeAuthorityConstituents === 5;
  const publicationState =
    constituents.length < 5 || healthyMarketSources === 0
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
    isLive: constituents.length === 5 && healthyMarketSources > 0,
    dataMode: useIdentity
      ? "live-human-estimate"
      : useWalletObservation
        ? "live-wallet-observation"
        : constituents.length === 5
          ? "live-market-proxy"
          : "fallback",
    windowMinutes: useIdentity || useWalletObservation ? 30 : 60,
    methodologyVersion: "4.0",
    weighting: {
      scheme: "capped-float-market-cap",
      maximumConstituentWeight: MAX_CONSTITUENT_WEIGHT,
      continuity: "divisor",
    },
    identityNotice: useIdentity
      ? "Bot除外と高信頼クラスタリング後の推定アクティブ買い手を使用"
      : useWalletObservation
        ? "公開取引の署名ウォレットを重複・Bot・極小取引で補正した推定値。人物数そのものではありません"
        : "人物推定データが未達のため、順位は市場取引量による暫定値です",
    publication: {
      state: publicationState,
      tokenNavEligible,
      sourceQuorum: healthyMarketSources,
      consensusConstituents,
      chainVerifiedConstituents,
      safeAuthorityConstituents,
      demandObservedConstituents,
      completeDemandConstituents,
      reasons,
    },
    dataSources,
    constituents,
  };
}

function hasMarketConsensus(coin: MarketCandidate) {
  return (
    (coin.marketSources?.length ?? 0) >= 2 &&
    (coin.priceDivergenceBps ?? Number.POSITIVE_INFINITY) <=
      MAX_PRICE_DIVERGENCE_BPS &&
    (coin.marketCapDivergenceBps ?? Number.POSITIVE_INFINITY) <=
      MAX_MARKET_CAP_DIVERGENCE_BPS &&
    (coin.marketConfidence ?? 0) >= MIN_MARKET_CONFIDENCE
  );
}

function rankingBuyUsd(
  coin: MarketCandidate,
  useIdentity: boolean,
  useWalletObservation: boolean,
) {
  if (useIdentity) return coin.demand?.qualifiedBuyUsd ?? 0;
  if (useWalletObservation) return coin.demand?.grossBuyUsd ?? 0;
  return proxyBuyVolume(coin);
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
  ([
    tokenAddress,
    symbol,
    name,
    priceUsd,
    marketCap,
    liquidityUsd,
    volumeUsd,
    buys,
    sells,
    changePercent,
  ]) => ({
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
import {
  cappedMarketWeights,
  MAX_CONSTITUENT_WEIGHT,
} from "./weighting.ts";
