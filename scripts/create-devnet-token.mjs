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
  getAccount,
  getMetadataPointerState,
  getMint,
  getMintLen,
  getOrCreateAssociatedTokenAccount,
  getTokenMetadata,
  mintTo,
  setAuthority,
  tokenMetadataInitializeWithRentTransfer,
  tokenMetadataUpdateAuthority,
  tokenMetadataUpdateFieldWithRentTransfer,
} from "@solana/spl-token";

const RPC_URL =
  process.env.SOLANA_DEVNET_RPC_URL ?? "https://api.devnet.solana.com";
const KEY_PATH = new URL("../.secrets/mt5-devnet-issuer.json", import.meta.url);
const MINT_KEY_PATH = new URL(
  "../.secrets/mt5-devnet-mint.json",
  import.meta.url,
);
const PROGRESS_PATH = new URL(
  "../.secrets/mt5-devnet-progress.json",
  import.meta.url,
);
const OUTPUT_PATH = new URL(
  "../public/token/devnet-deployment.json",
  import.meta.url,
);
const NAME = "MT5 Research Index";
const SYMBOL = "MT5R";
const DECIMALS = 6;
const WHOLE_SUPPLY = 1_000_000_000n;
const METADATA_URI =
  "https://mt5-online-index.meme-top-5-index.workers.dev/token/metadata.json";

const existing = await readJson(OUTPUT_PATH);
if (existing?.mintAddress) {
  console.log(`Already deployed: ${existing.mintAddress}`);
  process.exit(0);
}

await mkdir(new URL("../.secrets/", import.meta.url), { recursive: true });
const payer = await loadOrCreateKeypair(KEY_PATH);
const mint = await loadOrCreateKeypair(MINT_KEY_PATH);
const connection = new Connection(RPC_URL, "confirmed");

await ensureDevnetBalance(connection, payer);

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
const progress = (await readJson(PROGRESS_PATH)) ?? {
  mintAddress: mint.publicKey.toBase58(),
  signatures: {},
};
if (progress.mintAddress !== mint.publicKey.toBase58()) {
  throw new Error("Saved Devnet mint key does not match deployment progress.");
}

const mintLength = getMintLen([ExtensionType.MetadataPointer]);
const rent = await connection.getMinimumBalanceForRentExemption(mintLength);

if (!(await connection.getAccountInfo(mint.publicKey, "confirmed"))) {
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

  const signature = await sendAndConfirmTransaction(
    connection,
    createMintTransaction,
    [payer, mint],
    { commitment: "confirmed" },
  );
  await recordSignature("createMint", signature);
}

let mintInfo = await getMint(
  connection,
  mint.publicKey,
  "confirmed",
  TOKEN_2022_PROGRAM_ID,
);
let metadataInfo = await getTokenMetadata(
  connection,
  mint.publicKey,
  "confirmed",
  TOKEN_2022_PROGRAM_ID,
);
if (!metadataInfo) {
  const signature = await tokenMetadataInitializeWithRentTransfer(
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
  await recordSignature("initializeMetadata", signature);
}

for (const [key, value] of metadata.additionalMetadata) {
  metadataInfo = await getTokenMetadata(
    connection,
    mint.publicKey,
    "confirmed",
    TOKEN_2022_PROGRAM_ID,
  );
  const currentValue = metadataInfo?.additionalMetadata.find(
    ([currentKey]) => currentKey === key,
  )?.[1];
  if (currentValue === value) continue;

  const signature = await tokenMetadataUpdateFieldWithRentTransfer(
    connection,
    payer,
    mint.publicKey,
    payer,
    key,
    value,
    [],
    { commitment: "confirmed" },
    TOKEN_2022_PROGRAM_ID,
  );
  await recordSignature(`metadataField.${key}`, signature);
}

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
mintInfo = await getMint(
  connection,
  mint.publicKey,
  "confirmed",
  TOKEN_2022_PROGRAM_ID,
);
if (mintInfo.supply === 0n) {
  const signature = await mintTo(
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
  await recordSignature("mintSupply", signature);
} else if (mintInfo.supply !== atomicSupply) {
  throw new Error(
    `Unexpected existing supply: ${mintInfo.supply.toString()} atomic units.`,
  );
}

mintInfo = await getMint(
  connection,
  mint.publicKey,
  "confirmed",
  TOKEN_2022_PROGRAM_ID,
);
if (mintInfo.mintAuthority) {
  if (!mintInfo.mintAuthority.equals(payer.publicKey)) {
    throw new Error("Mint authority is not the disposable Devnet issuer.");
  }
  const signature = await setAuthority(
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
  await recordSignature("revokeMintAuthority", signature);
}

mintInfo = await getMint(
  connection,
  mint.publicKey,
  "confirmed",
  TOKEN_2022_PROGRAM_ID,
);
const metadataPointer = getMetadataPointerState(mintInfo);
if (metadataPointer?.authority) {
  if (!metadataPointer.authority.equals(payer.publicKey)) {
    throw new Error("Metadata pointer authority is not the Devnet issuer.");
  }
  const signature = await setAuthority(
    connection,
    payer,
    mint.publicKey,
    payer,
    AuthorityType.MetadataPointer,
    null,
    [],
    { commitment: "confirmed" },
    TOKEN_2022_PROGRAM_ID,
  );
  await recordSignature("revokeMetadataPointerAuthority", signature);
}

metadataInfo = await getTokenMetadata(
  connection,
  mint.publicKey,
  "confirmed",
  TOKEN_2022_PROGRAM_ID,
);
if (metadataInfo?.updateAuthority) {
  if (!metadataInfo.updateAuthority.equals(payer.publicKey)) {
    throw new Error("Metadata update authority is not the Devnet issuer.");
  }
  const signature = await tokenMetadataUpdateAuthority(
    connection,
    payer,
    mint.publicKey,
    payer,
    null,
    [],
    { commitment: "confirmed" },
    TOKEN_2022_PROGRAM_ID,
  );
  await recordSignature("revokeMetadataUpdateAuthority", signature);
}

const verifiedMint = await getMint(
  connection,
  mint.publicKey,
  "confirmed",
  TOKEN_2022_PROGRAM_ID,
);
const verifiedTokenAccount = await getAccount(
  connection,
  tokenAccount.address,
  "confirmed",
  TOKEN_2022_PROGRAM_ID,
);
const verifiedMetadata = await getTokenMetadata(
  connection,
  mint.publicKey,
  "confirmed",
  TOKEN_2022_PROGRAM_ID,
);
const verifiedPointer = getMetadataPointerState(verifiedMint);
verifyDeployment({
  mint: verifiedMint,
  tokenAccount: verifiedTokenAccount,
  metadata: verifiedMetadata,
  pointer: verifiedPointer,
  atomicSupply,
});

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
  metadataPointerAuthority: null,
  status: "research-only",
  deployedAt: new Date().toISOString(),
  explorerUrl: `https://explorer.solana.com/address/${mint.publicKey.toBase58()}?cluster=devnet`,
  signatures: {
    ...progress.signatures,
  },
  verification: {
    supplyAtomic: verifiedMint.supply.toString(),
    tokenAccountBalanceAtomic: verifiedTokenAccount.amount.toString(),
    metadataOnMint: verifiedMetadata?.mint.equals(mint.publicKey) ?? false,
    immutableMint: verifiedMint.mintAuthority === null,
    immutableMetadata: verifiedMetadata?.updateAuthority === undefined,
    immutableMetadataPointer: verifiedPointer?.authority === null,
  },
};

await writeFile(OUTPUT_PATH, `${JSON.stringify(deployment, null, 2)}\n`, "utf8");
console.log(JSON.stringify(deployment, null, 2));

async function loadOrCreateKeypair(path) {
  const saved = await readJson(path);
  if (Array.isArray(saved)) {
    return Keypair.fromSecretKey(Uint8Array.from(saved));
  }
  const created = Keypair.generate();
  await writeFile(path, JSON.stringify([...created.secretKey]), {
    encoding: "utf8",
    mode: 0o600,
  });
  return created;
}

async function recordSignature(label, signature) {
  progress.signatures[label] = signature;
  await writeFile(PROGRESS_PATH, `${JSON.stringify(progress, null, 2)}\n`, {
    encoding: "utf8",
    mode: 0o600,
  });
}

function verifyDeployment({
  mint,
  tokenAccount,
  metadata,
  pointer,
  atomicSupply,
}) {
  const additionalMetadata = new Map(metadata?.additionalMetadata ?? []);
  const valid =
    mint.decimals === DECIMALS &&
    mint.supply === atomicSupply &&
    mint.mintAuthority === null &&
    mint.freezeAuthority === null &&
    tokenAccount.amount === atomicSupply &&
    metadata?.mint.equals(mint.address) &&
    metadata.name === NAME &&
    metadata.symbol === SYMBOL &&
    metadata.uri === METADATA_URI &&
    metadata.updateAuthority === undefined &&
    additionalMetadata.get("status") === "research-only" &&
    additionalMetadata.get("redeemable") === "false" &&
    additionalMetadata.get("network") === "devnet" &&
    pointer?.metadataAddress?.equals(mint.address) &&
    pointer.authority === null;

  if (!valid) {
    throw new Error("On-chain Devnet token verification failed.");
  }
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
