import assert from "node:assert/strict";
import test from "node:test";
import { createIngestSignature } from "../lib/ingest-security.ts";

test("ingest HMAC binds timestamp, nonce, and exact body", async () => {
  const secret = "test-secret-that-is-at-least-thirty-two-bytes";
  const base = {
    secret,
    timestamp: 1_785_110_400,
    nonce: "0123456789abcdef",
    body: JSON.stringify({ trades: [] }),
  };
  const signature = await createIngestSignature(base);
  assert.equal(signature.length, 43);
  assert.equal(signature, await createIngestSignature(base));
  assert.notEqual(
    signature,
    await createIngestSignature({ ...base, nonce: "fedcba9876543210" }),
  );
});
