import type { IndexSnapshot } from "./index-engine.ts";
import type { ReserveReport } from "./backing-engine.ts";
import { requestSolanaRpc } from "./solana-rpc.ts";

const TOKEN_PROGRAM_ID = "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA";
const TOKEN_2022_PROGRAM_ID =
  "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb";
const SQUADS_V4_PROGRAM_ID =
  "SQDS4ep65T869zMMBKyuUq6aD6EgTu8psMjkvj52pCf";
export const MAINNET_USDC_MINT =
  "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";

type TokenAccountResult = {
  value: Array<{
    pubkey: string;
    account: {
      data: {
        parsed?: {
          info?: {
            mint?: string;
            owner?: string;
            tokenAmount?: {
              amount?: string;
              decimals?: number;
              uiAmountString?: string;
            };
          };
        };
      };
    };
  }>;
};

type AccountInfoResult = {
  value: null | {
    owner: string;
    data:
      | [string, string]
      | {
          parsed?: {
            info?: {
              decimals?: number;
              mintAuthority?: string | null;
              freezeAuthority?: string | null;
              supply?: string;
            };
          };
        };
  };
};

type TokenSupplyResult = {
  value: {
    amount: string;
    decimals: number;
    uiAmountString?: string;
  };
};

export type VaultConfiguration = {
  ownerAddress?: string;
  multisigAddress?: string;
  shareMintAddress?: string;
  freezeAuthorityAddress?: string;
  cashMintAddress?: string;
  heliusApiKey?: string;
};

export async function verifyOnchainVault(
  snapshot: IndexSnapshot,
  configuration: VaultConfiguration,
) {
  const ownerAddress = normalizeAddress(configuration.ownerAddress);
  const multisigAddress = normalizeAddress(configuration.multisigAddress);
  const shareMintAddress = normalizeAddress(configuration.shareMintAddress);
  const freezeAuthorityAddress =
    normalizeAddress(configuration.freezeAuthorityAddress) ?? ownerAddress;
  const cashMintAddress =
    normalizeAddress(configuration.cashMintAddress) ?? MAINNET_USDC_MINT;

  if (!ownerAddress || !multisigAddress || !shareMintAddress) {
    return {
      status: "unconfigured" as const,
      configured: false,
      verified: false,
      report: null,
      reasons: [
        "Squads Vault、Multisig、またはMT5 Share Mintの公開アドレスが未設定です",
      ],
    };
  }

  try {
    const [classicAccounts, token2022Accounts, shareMint, shareSupply, multisig] =
      await Promise.all([
        readTokenAccounts(
          ownerAddress,
          TOKEN_PROGRAM_ID,
          configuration.heliusApiKey,
        ),
        readTokenAccounts(
          ownerAddress,
          TOKEN_2022_PROGRAM_ID,
          configuration.heliusApiKey,
        ),
        requestSolanaRpc<AccountInfoResult>({
          apiKey: configuration.heliusApiKey,
          id: "mt5-share-mint",
          method: "getAccountInfo",
          params: [
            shareMintAddress,
            { encoding: "jsonParsed", commitment: "confirmed" },
          ],
        }),
        requestSolanaRpc<TokenSupplyResult>({
          apiKey: configuration.heliusApiKey,
          id: "mt5-share-supply",
          method: "getTokenSupply",
          params: [shareMintAddress, { commitment: "confirmed" }],
        }),
        requestSolanaRpc<AccountInfoResult>({
          apiKey: configuration.heliusApiKey,
          id: "mt5-squads-multisig",
          method: "getAccountInfo",
          params: [
            multisigAddress,
            { encoding: "base64", commitment: "confirmed" },
          ],
        }),
      ]);
    const balances = mergeTokenAccounts(
      classicAccounts,
      token2022Accounts,
    );
    const allowedMints = new Set([
      ...snapshot.constituents.map((coin) => coin.tokenAddress),
      cashMintAddress,
    ]);
    const unexpectedMints = [...balances.entries()]
      .filter(([mint, quantity]) => !allowedMints.has(mint) && quantity > 0)
      .map(([mint]) => mint);
    const shareInfo =
      !Array.isArray(shareMint.value?.data) &&
      shareMint.value?.data?.parsed?.info
        ? shareMint.value.data.parsed.info
        : null;
    const authorityChecks = {
      multisigOwnedBySquads:
        multisig.value?.owner === SQUADS_V4_PROGRAM_ID,
      shareMintUsesToken2022:
        shareMint.value?.owner === TOKEN_2022_PROGRAM_ID,
      mintAuthorityIsVault:
        shareInfo?.mintAuthority === ownerAddress,
      freezeAuthorityIsConfiguredVault:
        shareInfo?.freezeAuthority === freezeAuthorityAddress,
    };
    const reasons: string[] = [];
    if (!authorityChecks.multisigOwnedBySquads) {
      reasons.push("設定されたMultisigはSquads V4プログラム所有ではありません");
    }
    if (!authorityChecks.shareMintUsesToken2022) {
      reasons.push("MT5 Share MintはToken-2022ではありません");
    }
    if (!authorityChecks.mintAuthorityIsVault) {
      reasons.push("MT5 Share Mintの発行権限がSquads Vaultと一致しません");
    }
    if (!authorityChecks.freezeAuthorityIsConfiguredVault) {
      reasons.push("MT5 Share MintのFreeze権限が承認済みVaultと一致しません");
    }
    if (unexpectedMints.length > 0) {
      reasons.push("専用Vaultに指数外・現金外のトークン残高があります");
    }

    const report: ReserveReport = {
      reportId: `onchain-${snapshot.asOf}`,
      sequence: Math.floor(new Date(snapshot.asOf).getTime() / 1000),
      asOf: Math.floor(Date.now() / 1000),
      mode: "custodied",
      source: "solana-squads-vault",
      tokenSupply: decimalAmount(shareSupply.value),
      cashUsd: balances.get(cashMintAddress) ?? 0,
      liabilitiesUsd: 0,
      holdings: snapshot.constituents.map((coin) => ({
        tokenAddress: coin.tokenAddress,
        quantity: balances.get(coin.tokenAddress) ?? 0,
      })),
    };

    return {
      status: reasons.length === 0 ? ("verified" as const) : ("blocked" as const),
      configured: true,
      verified: reasons.length === 0,
      ownerAddress,
      multisigAddress,
      shareMintAddress,
      freezeAuthorityAddress,
      cashMintAddress,
      programIds: {
        squads: SQUADS_V4_PROGRAM_ID,
        token2022: TOKEN_2022_PROGRAM_ID,
      },
      authorityChecks,
      unexpectedMints,
      report,
      reasons,
    };
  } catch (error) {
    return {
      status: "error" as const,
      configured: true,
      verified: false,
      report: null,
      reasons: [
        `オンチェーンVault検証に失敗しました: ${
          error instanceof Error ? error.message : "unknown error"
        }`,
      ],
    };
  }
}

export function compareReserveReports(
  attested: ReserveReport,
  onchain: ReserveReport,
  maximumDifferenceBps = 10,
) {
  const onchainByMint = new Map(
    onchain.holdings.map((holding) => [
      holding.tokenAddress,
      holding.quantity,
    ]),
  );
  const differences = attested.holdings.map((holding) => {
    const chainQuantity = onchainByMint.get(holding.tokenAddress) ?? 0;
    return {
      tokenAddress: holding.tokenAddress,
      differenceBps: relativeDifferenceBps(holding.quantity, chainQuantity),
    };
  });
  differences.push({
    tokenAddress: "cash",
    differenceBps: relativeDifferenceBps(
      attested.cashUsd,
      onchain.cashUsd,
    ),
  });
  differences.push({
    tokenAddress: "share-supply",
    differenceBps: relativeDifferenceBps(
      attested.tokenSupply,
      onchain.tokenSupply,
    ),
  });
  const maximumObservedDifferenceBps = Math.max(
    0,
    ...differences.map((item) => item.differenceBps),
  );
  return {
    maximumAllowedDifferenceBps: maximumDifferenceBps,
    maximumObservedDifferenceBps,
    matches: maximumObservedDifferenceBps <= maximumDifferenceBps,
    differences,
  };
}

async function readTokenAccounts(
  ownerAddress: string,
  programId: string,
  apiKey?: string,
) {
  return requestSolanaRpc<TokenAccountResult>({
    apiKey,
    id: `mt5-vault-${programId.slice(0, 6)}`,
    method: "getTokenAccountsByOwner",
    params: [
      ownerAddress,
      { programId },
      { encoding: "jsonParsed", commitment: "confirmed" },
    ],
  });
}

function mergeTokenAccounts(...responses: TokenAccountResult[]) {
  const balances = new Map<string, number>();
  for (const response of responses) {
    for (const item of response.value) {
      const info = item.account.data.parsed?.info;
      const mint = info?.mint;
      const quantity = Number(info?.tokenAmount?.uiAmountString ?? 0);
      if (!mint || !Number.isFinite(quantity)) continue;
      balances.set(mint, (balances.get(mint) ?? 0) + quantity);
    }
  }
  return balances;
}

function decimalAmount(value: TokenSupplyResult["value"]) {
  if (value.uiAmountString) return Number(value.uiAmountString);
  return Number(BigInt(value.amount)) / 10 ** value.decimals;
}

function relativeDifferenceBps(left: number, right: number) {
  const denominator = Math.max(Math.abs(left), Math.abs(right), 1e-12);
  return (Math.abs(left - right) / denominator) * 10_000;
}

function normalizeAddress(value?: string) {
  const normalized = value?.trim();
  return normalized && /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(normalized)
    ? normalized
    : null;
}
