#!/usr/bin/env node

import { readFile } from "node:fs/promises";
import { createHash, createPublicKey, verify } from "node:crypto";

const gateUrl = new URL("../token/mainnet-release-gate.json", import.meta.url);
const gate = JSON.parse(await readFile(gateUrl, "utf8"));
const indexUrl =
  process.env.MT5_INDEX_URL ??
  "https://mt5-online-index.meme-top-5-index.workers.dev/api/index";
const failures = [];

for (const [name, passed] of Object.entries(gate.checks ?? {})) {
  if (passed !== true) failures.push(`release gate: ${name}`);
}

try {
  const response = await fetch(indexUrl, {
    headers: { Accept: "application/json" },
    signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok) {
    failures.push(`index endpoint returned HTTP ${response.status}`);
  } else {
    const body = await response.text();
    const snapshot = JSON.parse(body);
    const requirements = gate.liveIndexRequirements;
    if (snapshot?.methodologyVersion !== requirements.methodologyVersion) {
      failures.push(
        `methodology version is ${snapshot?.methodologyVersion ?? "missing"}`,
      );
    }
    if (snapshot?.publication?.state !== requirements.publicationState) {
      failures.push(
        `publication state is ${snapshot?.publication?.state ?? "missing"}`,
      );
    }
    if (
      snapshot?.publication?.tokenNavEligible !==
      requirements.tokenNavEligible
    ) {
      failures.push("token NAV is not eligible");
    }
    if (
      Number(snapshot?.publication?.sourceQuorum ?? 0) <
      requirements.minimumSourceQuorum
    ) {
      failures.push("market source quorum is below the release threshold");
    }
    if (
      Number(snapshot?.publication?.consensusConstituents ?? 0) !==
      requirements.requiredConsensusConstituents
    ) {
      failures.push("not all five constituents have market-data consensus");
    }
    if (
      Number(snapshot?.publication?.chainVerifiedConstituents ?? 0) !==
      requirements.requiredChainVerifiedConstituents
    ) {
      failures.push("not all five constituent mints are verified on-chain");
    }
    if (
      Number(snapshot?.publication?.safeAuthorityConstituents ?? 0) !==
      requirements.requiredSafeAuthorityConstituents
    ) {
      failures.push("one or more constituents retain mint or freeze authority");
    }
    if (requirements.snapshotSignatureRequired) {
      await verifySnapshotResponse(response, body, indexUrl, failures);
    }
  }
} catch (error) {
  failures.push(
    `index readiness check failed: ${
      error instanceof Error ? error.message : String(error)
    }`,
  );
}

try {
  const backingUrl = new URL("/api/backing", indexUrl);
  const response = await fetch(backingUrl, {
    headers: { Accept: "application/json" },
    signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok) {
    failures.push(`backing endpoint returned HTTP ${response.status}`);
  } else {
    const backing = await response.json();
    const requirements = gate.backingRequirements;
    if (backing?.releaseEligible !== requirements.releaseEligible) {
      failures.push("backing release gate is not eligible");
    }
    if (
      Number(backing?.attestationQuorum?.observed ?? 0) <
      requirements.minimumAttestations
    ) {
      failures.push("reserve attestation quorum is below two signers");
    }
    if (
      Number(backing?.reserve?.reserveRatioBps ?? 0) <
      requirements.minimumReserveRatioBps
    ) {
      failures.push("reserve ratio is below 102%");
    }
    if (
      Number(backing?.reserve?.maximumWeightDriftBps ?? Infinity) >
      requirements.maximumWeightDriftBps
    ) {
      failures.push("reserve basket drift exceeds 100 bps");
    }
  }
} catch (error) {
  failures.push(
    `backing readiness check failed: ${
      error instanceof Error ? error.message : String(error)
    }`,
  );
}

if (failures.length > 0) {
  console.error("MAINNET RELEASE BLOCKED");
  for (const failure of failures) console.error(`- ${failure}`);
  process.exitCode = 2;
} else {
  console.log("MAINNET RELEASE GATES PASSED");
}

async function verifySnapshotResponse(response, body, endpoint, output) {
  const signature = response.headers.get("x-mt5-signature");
  const digest = response.headers.get("content-digest");
  const calculatedDigest = createHash("sha256")
    .update(body)
    .digest("base64url");
  if (digest !== `sha-256=${calculatedDigest}`) {
    output.push("snapshot content digest is missing or invalid");
  }
  if (!signature) {
    output.push("snapshot signature is missing");
    return;
  }

  const securityResponse = await fetch(new URL("/api/security", endpoint), {
    signal: AbortSignal.timeout(10_000),
  });
  const security = await securityResponse.json();
  const publicKeyRaw = security?.snapshotSigning?.publicKeyRawBase64;
  if (!publicKeyRaw) {
    output.push("snapshot signing public key is unavailable");
    return;
  }
  const spkiPrefix = Buffer.from("302a300506032b6570032100", "hex");
  const publicKey = createPublicKey({
    key: Buffer.concat([spkiPrefix, Buffer.from(publicKeyRaw, "base64")]),
    format: "der",
    type: "spki",
  });
  if (
    !verify(
      null,
      Buffer.from(body),
      publicKey,
      Buffer.from(signature, "base64url"),
    )
  ) {
    output.push("snapshot Ed25519 signature verification failed");
  }
}
