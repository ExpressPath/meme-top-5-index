import assert from "node:assert/strict";
import test from "node:test";
import { fallbackSnapshot } from "../lib/index-engine.ts";
import {
  compareReserveReports,
  verifyOnchainVault,
} from "../lib/vault-verifier.ts";

test("on-chain vault verification fails closed without public addresses", async () => {
  const result = await verifyOnchainVault(fallbackSnapshot, {});
  assert.equal(result.status, "unconfigured");
  assert.equal(result.verified, false);
  assert.equal(result.report, null);
});

test("reserve reconciliation detects quantity and supply divergence", () => {
  const base = {
    reportId: "report-1",
    sequence: 1,
    asOf: 1_785_110_400,
    mode: "custodied" as const,
    source: "attester",
    tokenSupply: 100,
    cashUsd: 20,
    liabilitiesUsd: 0,
    holdings: [
      {
        tokenAddress: "6p6xgHyF7AeE6TZkSmFsko444wqoP15icUSqi2jfGiPN",
        quantity: 10,
      },
    ],
  };
  const exact = compareReserveReports(base, {
    ...base,
    source: "solana-squads-vault",
  });
  assert.equal(exact.matches, true);

  const divergent = compareReserveReports(base, {
    ...base,
    source: "solana-squads-vault",
    tokenSupply: 101,
  });
  assert.equal(divergent.matches, false);
  assert.ok(divergent.maximumObservedDifferenceBps > 10);
});
