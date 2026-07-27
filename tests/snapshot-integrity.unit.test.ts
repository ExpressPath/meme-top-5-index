import assert from "node:assert/strict";
import test from "node:test";
import { generateKeyPairSync } from "node:crypto";
import {
  signSnapshotBody,
  verifySnapshotBody,
} from "../lib/snapshot-integrity.ts";

test("Ed25519 snapshot signatures verify and reject changed bodies", async () => {
  const { privateKey, publicKey } = generateKeyPairSync("ed25519");
  const privateKeyBase64 = privateKey
    .export({ format: "der", type: "pkcs8" })
    .toString("base64");
  const publicKeyDer = publicKey.export({ format: "der", type: "spki" });
  const publicKeyRawBase64 = publicKeyDer.subarray(-32).toString("base64");
  const body = JSON.stringify({ symbol: "MT5", value: 1000 });
  const signed = await signSnapshotBody(body, privateKeyBase64);

  assert.ok(signed.signature);
  assert.equal(
    await verifySnapshotBody(body, signed.signature!, publicKeyRawBase64),
    true,
  );
  assert.equal(
    await verifySnapshotBody(
      `${body} `,
      signed.signature!,
      publicKeyRawBase64,
    ),
    false,
  );
});
