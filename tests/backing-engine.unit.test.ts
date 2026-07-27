import assert from "node:assert/strict";
import test from "node:test";
import {
  buildBackingPlan,
  evaluateReserveReport,
} from "../lib/backing-engine.ts";
import { fallbackSnapshot } from "../lib/index-engine.ts";

test("a 102% custodied basket passes numeric reserve controls", () => {
  const snapshot = {
    ...fallbackSnapshot,
    publication: {
      ...fallbackSnapshot.publication,
      tokenNavEligible: true,
    },
  };
  const plan = buildBackingPlan(snapshot, 100_000);
  const evaluation = evaluateReserveReport(
    snapshot,
    {
      reportId: "reserve-20260727",
      sequence: 1,
      asOf: 1_785_110_400,
      mode: "custodied",
      source: "test-custodian",
      tokenSupply: 100_000 / (snapshot.value / 1000),
      cashUsd: 2_000,
      liabilitiesUsd: 0,
      holdings: plan.holdings.map((holding) => ({
        tokenAddress: holding.tokenAddress,
        quantity: holding.targetQuantity,
      })),
    },
    1_785_110_400,
  );

  assert.ok(Math.abs(evaluation.reserveRatioBps - 10_200) < 1e-6);
  assert.ok(evaluation.maximumWeightDriftBps < 1e-6);
  assert.equal(evaluation.ready, true);
});

test("shadow reports fail closed", () => {
  const plan = buildBackingPlan(fallbackSnapshot, 100_000);
  const evaluation = evaluateReserveReport(
    fallbackSnapshot,
    {
      reportId: "shadow-20260727",
      sequence: 1,
      asOf: 1_785_110_400,
      mode: "shadow",
      source: "simulation",
      tokenSupply: 100_000,
      cashUsd: 2_000,
      liabilitiesUsd: 0,
      holdings: plan.holdings.map((holding) => ({
        tokenAddress: holding.tokenAddress,
        quantity: holding.targetQuantity,
      })),
    },
    1_785_110_400,
  );
  assert.equal(evaluation.ready, false);
  assert.ok(evaluation.reasons.some((reason) => reason.includes("シャドー")));
});
