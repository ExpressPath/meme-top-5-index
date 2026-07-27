import assert from "node:assert/strict";
import test from "node:test";
import { summarizePoolTrades } from "../lib/demand-data.ts";

const token = "TokenMint111111111111111111111111111111111";
const now = new Date("2026-07-27T10:00:00Z");

function trade({
  hash,
  wallet,
  time,
  amount,
  kind = "buy",
  to = token,
}: {
  hash: string;
  wallet: string;
  time: string;
  amount: number;
  kind?: "buy" | "sell";
  to?: string;
}) {
  return {
    attributes: {
      tx_hash: hash,
      tx_from_address: wallet,
      block_timestamp: time,
      kind,
      volume_in_usd: String(amount),
      to_token_address: to,
    },
  };
}

test("deduplicates transactions and filters dust while preserving gross volume", () => {
  const result = summarizePoolTrades(
    token,
    [
      trade({
        hash: "tx-1",
        wallet: "wallet-a",
        time: "2026-07-27T09:50:00Z",
        amount: 120,
      }),
      trade({
        hash: "tx-1",
        wallet: "wallet-a",
        time: "2026-07-27T09:50:00Z",
        amount: 100,
      }),
      trade({
        hash: "tx-2",
        wallet: "wallet-b",
        time: "2026-07-27T09:55:00Z",
        amount: 0.25,
      }),
      trade({
        hash: "tx-old",
        wallet: "wallet-c",
        time: "2026-07-27T09:20:00Z",
        amount: 999,
      }),
      trade({
        hash: "tx-sell",
        wallet: "wallet-d",
        time: "2026-07-27T09:58:00Z",
        amount: 500,
        kind: "sell",
        to: "QuoteMint",
      }),
    ],
    now,
  );

  assert.equal(result.grossBuyUsd, 120.25);
  assert.equal(result.qualifiedBuyUsd, 120);
  assert.equal(result.observedBuyerWallets, 2);
  assert.equal(result.estimatedUsers, 1);
  assert.equal(result.filteredWallets, 1);
  assert.equal(result.observedTrades, 2);
  assert.equal(result.coverageComplete, true);
  assert.equal(result.identityConfidence, 0.55);
});

test("marks a saturated 300-trade window as a lower bound", () => {
  const rows = Array.from({ length: 300 }, (_, index) =>
    trade({
      hash: `tx-${index}`,
      wallet: `wallet-${index}`,
      time: "2026-07-27T09:59:00Z",
      amount: 5,
    }),
  );
  const result = summarizePoolTrades(token, rows, now);

  assert.equal(result.coverageComplete, false);
  assert.equal(result.identityConfidence, 0.35);
  assert.equal(result.observedBuyerWallets, 300);
  assert.equal(result.estimatedUsers, 300);
});

test("filters burst automation from the estimated buyer count", () => {
  const rows = Array.from({ length: 8 }, (_, index) =>
    trade({
      hash: `bot-${index}`,
      wallet: "burst-wallet",
      time: `2026-07-27T09:59:0${index}Z`,
      amount: 10,
    }),
  );
  const result = summarizePoolTrades(token, rows, now);

  assert.equal(result.observedBuyerWallets, 1);
  assert.equal(result.estimatedUsers, 0);
  assert.equal(result.filteredWallets, 1);
  assert.equal(result.grossBuyUsd, 80);
  assert.equal(result.qualifiedBuyUsd, 0);
});
