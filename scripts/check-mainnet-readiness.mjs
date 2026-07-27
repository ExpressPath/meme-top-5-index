#!/usr/bin/env node

import { readFile } from "node:fs/promises";

const gateUrl = new URL("../token/mainnet-release-gate.json", import.meta.url);
const gate = JSON.parse(await readFile(gateUrl, "utf8"));
const indexUrl =
  process.env.MT5_INDEX_URL ??
  "https://meme-top-5-index.provf-official.chatgpt.site/api/index";
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
    const snapshot = await response.json();
    const requirements = gate.liveIndexRequirements;
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
  }
} catch (error) {
  failures.push(
    `index readiness check failed: ${
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
