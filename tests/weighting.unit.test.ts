import assert from "node:assert/strict";
import test from "node:test";
import { cappedMarketWeights } from "../lib/weighting.ts";

test("capped market weights remain fully invested and cap concentration", () => {
  const weights = cappedMarketWeights([900, 50, 25, 15, 10], 0.35);
  assert.ok(Math.abs(weights.reduce((sum, value) => sum + value, 0) - 1) < 1e-12);
  assert.ok(weights.every((weight) => weight <= 0.35 + 1e-12));
  assert.equal(weights[0], 0.35);
  assert.ok(weights[1] > weights[2]);
});

test("capped market weights reject an impossible cap", () => {
  assert.throws(
    () => cappedMarketWeights([1, 1, 1, 1, 1], 0.19),
    /cannot produce a fully invested index/,
  );
});
