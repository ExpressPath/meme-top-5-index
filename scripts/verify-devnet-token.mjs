#!/usr/bin/env node

import { readFile } from "node:fs/promises";

const deploymentUrl = new URL(
  "../public/token/devnet-deployment.json",
  import.meta.url,
);
const deployment = JSON.parse(await readFile(deploymentUrl, "utf8"));
const rpcUrl =
  process.env.SOLANA_DEVNET_RPC_URL ?? "https://api.devnet.solana.com";

const mint = await rpc("getAccountInfo", [
  deployment.mintAddress,
  { encoding: "jsonParsed", commitment: "confirmed" },
]);
const tokenAccount = await rpc("getTokenAccountBalance", [
  deployment.tokenAccount,
  { commitment: "confirmed" },
]);

const mintInfo = mint?.value?.data?.parsed?.info;
const expectedAtomicSupply =
  BigInt(deployment.supply) * 10n ** BigInt(deployment.decimals);
const actualAtomicSupply = BigInt(mintInfo?.supply ?? -1);
const actualTokenBalance = BigInt(tokenAccount?.value?.amount ?? -1);
const checks = {
  accountExists: Boolean(mint?.value),
  token2022Owner: mint?.value?.owner === deployment.programId,
  decimalsMatch: Number(mintInfo?.decimals) === deployment.decimals,
  supplyMatch: actualAtomicSupply === expectedAtomicSupply,
  tokenAccountBalanceMatch: actualTokenBalance === expectedAtomicSupply,
  mintAuthorityRevoked: mintInfo?.mintAuthority === null,
  freezeAuthorityRevoked: mintInfo?.freezeAuthority === null,
};
const failed = Object.entries(checks)
  .filter(([, passed]) => !passed)
  .map(([name]) => name);

console.log(
  JSON.stringify(
    {
      network: deployment.network,
      mintAddress: deployment.mintAddress,
      tokenAccount: deployment.tokenAccount,
      checks,
    },
    null,
    2,
  ),
);

if (failed.length > 0) {
  console.error(`Devnet verification failed: ${failed.join(", ")}`);
  process.exitCode = 2;
}

async function rpc(method, params) {
  const response = await fetch(rpcUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: `mt5-${method}`,
      method,
      params,
    }),
    signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok) throw new Error(`${method} HTTP ${response.status}`);
  const body = await response.json();
  if (body.error) {
    throw new Error(`${method}: ${body.error.message ?? "RPC error"}`);
  }
  return body.result;
}
