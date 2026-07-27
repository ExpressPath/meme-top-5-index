#!/usr/bin/env node

import { createPrivateKey, sign } from "node:crypto";

const required = [
  "MT5_INDEX_URL",
  "MT5_ORACLE_ATTESTATION_URL",
  "MT5_ORACLE_ATTESTER_KEY_ID",
  "MT5_ORACLE_ATTESTER_PRIVATE_KEY",
];
for (const name of required) {
  if (!process.env[name]) throw new Error(`${name} is required`);
}

const response = await fetch(process.env.MT5_INDEX_URL, {
  headers: { Accept: "application/json" },
  cache: "no-store",
  signal: AbortSignal.timeout(10_000),
});
if (!response.ok) throw new Error(`Index HTTP ${response.status}`);
await response.arrayBuffer();
const digest = response.headers.get("content-digest");
if (!digest) throw new Error("Index Content-Digest is missing");

const asOf = Math.floor(Date.now() / 1000);
const message = `${digest}\n${asOf}`;
const privateKey = createPrivateKey({
  key: Buffer.from(
    process.env.MT5_ORACLE_ATTESTER_PRIVATE_KEY,
    "base64",
  ),
  format: "der",
  type: "pkcs8",
});
const signature = sign(null, Buffer.from(message), privateKey).toString(
  "base64url",
);
const attestationResponse = await fetch(
  process.env.MT5_ORACLE_ATTESTATION_URL,
  {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      digest,
      keyId: process.env.MT5_ORACLE_ATTESTER_KEY_ID,
      signature,
      asOf,
    }),
    signal: AbortSignal.timeout(10_000),
  },
);
if (!attestationResponse.ok) {
  throw new Error(`Attestation HTTP ${attestationResponse.status}`);
}
console.log(
  JSON.stringify({
    accepted: true,
    digest,
    keyId: process.env.MT5_ORACLE_ATTESTER_KEY_ID,
    asOf,
  }),
);
