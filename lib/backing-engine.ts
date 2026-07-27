import type { IndexSnapshot } from "./index-engine.ts";

export const TARGET_RESERVE_RATIO_BPS = 10_200;
export const MAX_WEIGHT_DRIFT_BPS = 100;
export const MAX_RESERVE_REPORT_AGE_SECONDS = 24 * 60 * 60;

export type ReserveHolding = {
  tokenAddress: string;
  quantity: number;
};

export type ReserveReport = {
  reportId: string;
  sequence: number;
  asOf: number;
  mode: "shadow" | "custodied";
  source: string;
  tokenSupply: number;
  cashUsd: number;
  liabilitiesUsd: number;
  holdings: ReserveHolding[];
};

export function buildBackingPlan(
  snapshot: IndexSnapshot,
  referenceLiabilityUsd = 100_000,
) {
  const basketTargetUsd = referenceLiabilityUsd;
  const cashBufferUsd =
    (referenceLiabilityUsd * (TARGET_RESERVE_RATIO_BPS - 10_000)) / 10_000;

  return {
    mode: "shadow-plan" as const,
    referenceLiabilityUsd,
    basketTargetUsd,
    cashBufferUsd,
    totalReserveTargetUsd: basketTargetUsd + cashBufferUsd,
    targetReserveRatioBps: TARGET_RESERVE_RATIO_BPS,
    maximumWeightDriftBps: MAX_WEIGHT_DRIFT_BPS,
    rebalance: {
      frequency: "daily",
      effectiveTime: "00:00 UTC",
      emergencyRemoval:
        "oracle failure, liquidity breach, exploit, freeze, or legal restriction",
    },
    holdings: snapshot.constituents.map((coin) => ({
      tokenAddress: coin.tokenAddress,
      symbol: coin.symbol,
      targetWeight: coin.weight,
      targetValueUsd: basketTargetUsd * coin.weight,
      targetQuantity:
        coin.priceUsd > 0
          ? (basketTargetUsd * coin.weight) / coin.priceUsd
          : 0,
      priceUsd: coin.priceUsd,
    })),
  };
}

export function evaluateReserveReport(
  snapshot: IndexSnapshot,
  report: ReserveReport,
  nowSeconds = Math.floor(Date.now() / 1000),
) {
  const prices = new Map(
    snapshot.constituents.map((coin) => [
      coin.tokenAddress,
      { priceUsd: coin.priceUsd, targetWeight: coin.weight },
    ]),
  );
  const valuedHoldings = report.holdings.map((holding) => {
    const reference = prices.get(holding.tokenAddress);
    return {
      ...holding,
      valueUsd: reference ? holding.quantity * reference.priceUsd : 0,
      targetWeight: reference?.targetWeight ?? null,
      recognized: Boolean(reference),
    };
  });
  const basketValueUsd = valuedHoldings.reduce(
    (sum, holding) => sum + holding.valueUsd,
    0,
  );
  const netAssetsUsd =
    basketValueUsd + report.cashUsd - report.liabilitiesUsd;
  const referenceNavUsd = snapshot.value / 1000;
  const referenceLiabilityUsd = report.tokenSupply * referenceNavUsd;
  const reserveRatioBps =
    referenceLiabilityUsd > 0
      ? (netAssetsUsd / referenceLiabilityUsd) * 10_000
      : 0;
  const basketWeights = new Map(
    valuedHoldings.map((holding) => [
      holding.tokenAddress,
      basketValueUsd > 0 ? holding.valueUsd / basketValueUsd : 0,
    ]),
  );
  const maximumWeightDriftBps = snapshot.constituents.reduce(
    (maximum, coin) =>
      Math.max(
        maximum,
        Math.abs((basketWeights.get(coin.tokenAddress) ?? 0) - coin.weight) *
          10_000,
      ),
    0,
  );
  const unknownHoldings = valuedHoldings
    .filter((holding) => !holding.recognized)
    .map((holding) => holding.tokenAddress);
  const missingConstituents = snapshot.constituents
    .filter((coin) => (basketWeights.get(coin.tokenAddress) ?? 0) <= 0)
    .map((coin) => coin.tokenAddress);
  const ageSeconds = Math.max(0, nowSeconds - report.asOf);
  const reasons: string[] = [];

  if (report.mode !== "custodied") {
    reasons.push("実保管資産ではなくシャドー報告です");
  }
  if (ageSeconds > MAX_RESERVE_REPORT_AGE_SECONDS) {
    reasons.push("準備資産報告が24時間を超えて古くなっています");
  }
  if (reserveRatioBps + 1e-6 < TARGET_RESERVE_RATIO_BPS) {
    reasons.push("純資産が102%の準備率を満たしていません");
  }
  if (maximumWeightDriftBps > MAX_WEIGHT_DRIFT_BPS + 1e-6) {
    reasons.push("構成資産の最大乖離が1%を超えています");
  }
  if (unknownHoldings.length > 0) {
    reasons.push("指数外の資産が準備資産報告に含まれています");
  }
  if (missingConstituents.length > 0) {
    reasons.push("指数構成資産の一部が準備資産報告にありません");
  }

  return {
    reportId: report.reportId,
    sequence: report.sequence,
    asOf: new Date(report.asOf * 1000).toISOString(),
    ageSeconds,
    mode: report.mode,
    source: report.source,
    basketValueUsd,
    cashUsd: report.cashUsd,
    liabilitiesUsd: report.liabilitiesUsd,
    netAssetsUsd,
    tokenSupply: report.tokenSupply,
    referenceNavUsd,
    calculatedNavUsd:
      report.tokenSupply > 0 ? netAssetsUsd / report.tokenSupply : 0,
    reserveRatioBps,
    maximumWeightDriftBps,
    unknownHoldings,
    missingConstituents,
    ready:
      reasons.length === 0 &&
      snapshot.publication.tokenNavEligible,
    reasons,
  };
}
