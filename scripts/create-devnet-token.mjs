#!/usr/bin/env node

import { mkdir, readFile, writeFile } from "node:fs/promises";
import {
  Connection,
  Keypair,
  LAMPORTS_PER_SOL,
  SystemProgram,
  Transaction,
  sendAndConfirmTransaction,
} from "@solana/web3.js";
import {
  AuthorityType,
  ExtensionType,
  TOKEN_2022_PROGRAM_ID,
  createInitializeMetadataPointerInstruction,
  createInitializeMintInstruction,
  getMintLen,
  getOrCreateAssociatedTokenAccount,
  mintTo,
  setAuthority,
  tokenMetadataInitialize,
  tokenMetadataUpdateAuthority,
} from "@solana/spl-token";
import { pack } from "@solana/spl-token-metadata";

const RPC_URL =
  process.env.SOLANA_DEVNET_RPC_URL ?? "https://api.devnet.solana.com";
const KEY_PATH = new URL("../.secrets/mt5-devnet-issuer.json", import.meta.url);
const OUTPUT_PATH = new URL("../token/devnet-deployment.json", import.meta.url);
const NAME = "MT5 Research Index";
const SYMBOL = "MT5R";
const DECIMALS = 6;
const WHOLE_SUPPLY = 1_000_000_000n;
const METADATA_URI =
  "https://meme-top-5-index.provf-official.chatgpt.site/token/metadata.json";

const existing = await readJson(OUTPUT_PATH);
if (existing?.mintAddress) {
  console.log(`Already deployed: ${existing.mintAddress}`);
  process.exit(0);
}

await mkdir(new URL("../.secrets/", import.meta.url), { recursive: true });
const payer = await loadOrCreateKeypair();
const connection = new Connection(RPC_URL, "confirmed");

await ensureDevnetBalance(connection, payer);

const mint = Keypair.generate();
const metadata = {
  updateAuthority: payer.publicKey,
  mint: mint.publicKey,
  name: NAME,
  symbol: SYMBOL,
  uri: METADATA_URI,
  additionalMetadata: [
    ["status", "research-only"],
    ["redeemable", "false"],
    ["network", "devnet"],
  ],
};
const mintLength = getMintLen(
  [ExtensionType.MetadataPointer],
  { [ExtensionType.TokenMetadata]: pack(metadata).length },
);
const rent = await connection.getMinimumBalanceForRentExemption(mintLength);

const createMintTransaction = new Transaction().add(
  SystemProgram.createAccount({
    fromPubkey: payer.publicKey,
    newAccountPubkey: mint.publicKey,
    space: mintLength,
    lamports: rent,
    programId: TOKEN_2022_PROGRAM_ID,
  }),
  createInitializeMetadataPointerInstruction(
    mint.publicKey,
    payer.publicKey,
    mint.publicKey,
    TOKEN_2022_PROGRAM_ID,
  ),
  createInitializeMintInstruction(
    mint.publicKey,
    DECIMALS,
    payer.publicKey,
    null,
    TOKEN_2022_PROGRAM_ID,
  ),
);

const createSignature = await sendAndConfirmTransaction(
  connection,
  createMintTransaction,
  [payer, mint],
  { commitment: "confirmed" },
);

const metadataSignature = await tokenMetadataInitialize(
  connection,
  payer,
  mint.publicKey,
  payer.publicKey,
  payer,
  NAME,
  SYMBOL,
  METADATA_URI,
  [],
  { commitment: "confirmed" },
  TOKEN_2022_PROGRAM_ID,
);

const tokenAccount = await getOrCreateAssociatedTokenAccount(
  connection,
  payer,
  mint.publicKey,
  payer.publicKey,
  false,
  "confirmed",
  undefined,
  TOKEN_2022_PROGRAM_ID,
);
const atomicSupply = WHOLE_SUPPLY * 10n ** BigInt(DECIMALS);
const mintSignature = await mintTo(
  connection,
  payer,
  mint.publicKey,
  tokenAccount.address,
  payer,
  atomicSupply,
  [],
  { commitment: "confirmed" },
  TOKEN_2022_PROGRAM_ID,
);

const revokeMintSignature = await setAuthority(
  connection,
  payer,
  mint.publicKey,
  payer,
  AuthorityType.MintTokens,
  null,
  [],
  { commitment: "confirmed" },
  TOKEN_2022_PROGRAM_ID,
);
const revokeMetadataSignature = await tokenMetadataUpdateAuthority(
  connection,
  payer,
  mint.publicKey,
  payer,
  null,
  [],
  { commitment: "confirmed" },
  TOKEN_2022_PROGRAM_ID,
);

const deployment = {
  network: "solana-devnet",
  programId: TOKEN_2022_PROGRAM_ID.toBase58(),
  mintAddress: mint.publicKey.toBase58(),
  tokenAccount: tokenAccount.address.toBase58(),
  name: NAME,
  symbol: SYMBOL,
  decimals: DECIMALS,
  supply: WHOLE_SUPPLY.toString(),
  metadataUri: METADATA_URI,
  mintAuthority: null,
  freezeAuthority: null,
  metadataUpdateAuthority: null,
  status: "research-only",
  deployedAt: new Date().toISOString(),
  explorerUrl: `https://explorer.solana.com/address/${mint.publicKey.toBase58()}?cluster=devnet`,
  signatures: {
    createMint: createSignature,
    initializeMetadata: metadataSignature,
    mintSupply: mintSignature,
    revokeMintAuthority: revokeMintSignature,
    revokeMetadataAuthority: revokeMetadataSignature,
  },
};

await writeFile(OUTPUT_PATH, `${JSON.stringify(deployment, null, 2)}\n`, "utf8");
console.log(JSON.stringify(deployment, null, 2));

async function loadOrCreateKeypair() {
  const saved = await readJson(KEY_PATH);
  if (Array.isArray(saved)) {
    return Keypair.fromSecretKey(Uint8Array.from(saved));
  }
  const created = Keypair.generate();
  await writeFile(KEY_PATH, JSON.stringify([...created.secretKey]), {
    encoding: "utf8",
    mode: 0o600,
  });
  return created;
}

async function ensureDevnetBalance(connection, signer) {
  let balance = await connection.getBalance(signer.publicKey, "confirmed");
  if (balance >= 0.02 * LAMPORTS_PER_SOL) return;

  for (const amount of [0.1, 0.05, 0.02]) {
    try {
      const signature = await connection.requestAirdrop(
        signer.publicKey,
        amount * LAMPORTS_PER_SOL,
      );
      const latest = await connection.getLatestBlockhash("confirmed");
      await connection.confirmTransaction(
        { signature, ...latest },
        "confirmed",
      );
      balance = await connection.getBalance(signer.publicKey, "confirmed");
      if (balance >= 0.02 * LAMPORTS_PER_SOL) return;
    } catch {
      // Try a smaller faucet request.
    }
  }

  throw new Error(
    `Devnet faucet did not fund ${signer.publicKey.toBase58()}. Fund this disposable devnet address and rerun npm run token:devnet.`,
  );
}

async function readJson(url) {
  try {
    return JSON.parse(await readFile(url, "utf8"));
  } catch {
    return null;
  }
}
