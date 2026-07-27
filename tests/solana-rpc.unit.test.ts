import assert from "node:assert/strict";
import test from "node:test";
import { requestSolanaRpc } from "../lib/solana-rpc.ts";

test("fails over from PublicNode to the official Solana endpoint", async () => {
  const requested: string[] = [];
  const result = await requestSolanaRpc<number>({
    id: "slot-test",
    method: "getSlot",
    params: [],
    fetcher: async (input) => {
      const url = String(input);
      requested.push(url);
      if (url.includes("publicnode.com")) {
        return new Response("blocked", { status: 403 });
      }
      return Response.json({ jsonrpc: "2.0", id: "slot-test", result: 42 });
    },
  });

  assert.equal(result, 42);
  assert.deepEqual(requested, [
    "https://solana-rpc.publicnode.com",
    "https://api.mainnet-beta.solana.com",
  ]);
});

test("reports every failed RPC provider", async () => {
  await assert.rejects(
    requestSolanaRpc({
      id: "failure-test",
      method: "getSlot",
      params: [],
      fetcher: async () => new Response("unavailable", { status: 503 }),
    }),
    /solana-rpc\.publicnode\.com: HTTP 503; api\.mainnet-beta\.solana\.com: HTTP 503/,
  );
});
