export const MAX_CONSTITUENT_WEIGHT = 0.35;

export function cappedMarketWeights(
  marketCaps: number[],
  maximumWeight = MAX_CONSTITUENT_WEIGHT,
): number[] {
  if (marketCaps.length === 0) return [];
  if (
    !Number.isFinite(maximumWeight) ||
    maximumWeight <= 0 ||
    maximumWeight > 1 ||
    maximumWeight * marketCaps.length < 1 - 1e-12
  ) {
    throw new Error("The constituent cap cannot produce a fully invested index");
  }

  const positive = marketCaps.map((value) =>
    Number.isFinite(value) && value > 0 ? value : 0,
  );
  if (positive.every((value) => value === 0)) {
    return positive.map(() => 1 / positive.length);
  }

  const weights = positive.map(() => 0);
  const remaining = new Set(positive.map((_, index) => index));
  let remainingWeight = 1;

  while (remaining.size > 0) {
    const remainingMarketCap = [...remaining].reduce(
      (sum, index) => sum + positive[index],
      0,
    );
    const equalFallback = remainingMarketCap <= 0;
    const breaches = [...remaining].filter((index) => {
      const proposed = equalFallback
        ? remainingWeight / remaining.size
        : (remainingWeight * positive[index]) / remainingMarketCap;
      return proposed > maximumWeight + 1e-12;
    });

    if (breaches.length === 0) {
      for (const index of remaining) {
        weights[index] = equalFallback
          ? remainingWeight / remaining.size
          : (remainingWeight * positive[index]) / remainingMarketCap;
      }
      break;
    }

    for (const index of breaches) {
      weights[index] = maximumWeight;
      remaining.delete(index);
      remainingWeight -= maximumWeight;
    }
  }

  const total = weights.reduce((sum, weight) => sum + weight, 0);
  return weights.map((weight) => weight / total);
}
