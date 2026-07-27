import assert from "node:assert/strict";
import test from "node:test";
import { fallbackSnapshot } from "../lib/index-engine.ts";
import { advanceIndexState } from "../lib/index-store.ts";

test("divisor state preserves a continuous level and rebalances daily", () => {
  const initialSnapshot = {
    ...fallbackSnapshot,
    asOf: "2026-07-27T00:00:00.000Z",
  };
  const initial = advanceIndexState(null, initialSnapshot);
  assert.equal(initial.rebalanced, true);
  assert.ok(Math.abs(initial.snapshot.value - fallbackSnapshot.value) < 1e-9);

  const higherPrices = {
    ...initialSnapshot,
    asOf: "2026-07-27T12:00:00.000Z",
    constituents: initialSnapshot.constituents.map((coin) => ({
      ...coin,
      priceUsd: coin.priceUsd * 1.1,
    })),
  };
  const advanced = advanceIndexState(initial.state, higherPrices);
  assert.equal(advanced.rebalanced, false);
  assert.ok(
    Math.abs(advanced.snapshot.value - initial.snapshot.value * 1.1) < 1e-6,
  );

  const nextDay = advanceIndexState(advanced.state, {
    ...higherPrices,
    asOf: "2026-07-28T00:00:00.000Z",
  });
  assert.equal(nextDay.rebalanced, true);
  assert.ok(Math.abs(nextDay.snapshot.value - advanced.snapshot.value) < 1e-6);
});
