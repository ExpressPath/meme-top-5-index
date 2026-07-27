import type {
  DataSourceHealth,
  MarketCandidate,
} from "./index-engine";

const POLLER_ID = "helius-demand-v1";
const POLL_INTERVAL_SECONDS = 60;
const SIGNATURE_LIMIT = 5;
const REQUEST_TIMEOUT_MS = 6_000;

type PollOptions = {
  database?: D1Database;
  apiKey?: string;
  candidates: MarketCandidate[];
  now?: Date;
};

type SignatureInfo = {
  signature?: string;
  err?: unknown;
  blockTime?: number;
};

type RpcResponse<T> = {
  result?: T;
  error?: { message?: string };
};

export async function pollRpcDemand({
  database,
  apiKey,
  candidates,
  now = new Date(),
}: PollOptions): Promise<DataSourceHealth | null> {
  if (!database) return null;
  const startedAt = Date.now();
  const observedAt = now.toISOString();
  const targets = candidates
    .filter((coin) => coin.primaryPoolAddress)
    .slice(0, 5);
  if (targets.length === 0) {
    return health(false, 0, startedAt, observedAt, "no pool targets");
  }

  try {
    const nowSeconds = Math.floor(now.getTime() / 1000);
    await database
      .prepare(
        `INSERT OR IGNORE INTO collector_state
          (id, cursor, next_due, updated_at)
         VALUES (?, 0, 0, ?)`,
      )
      .bind(POLLER_ID, nowSeconds)
      .run();
    const state = await database
      .prepare(
        `SELECT cursor, next_due
         FROM collector_state
         WHERE id = ?`,
      )
      .bind(POLLER_ID)
      .first<{ cursor: number; next_due: number }>();
    if (!state) {
      return health(false, 0, startedAt, observedAt, "poller state unavailable");
    }

    const target = targets[state.cursor % targets.length];
    const lease = await database
      .prepare(
        `UPDATE collector_state
         SET cursor = cursor + 1,
             next_due = ?,
             updated_at = ?
         WHERE id = ?
           AND next_due <= ?`,
      )
      .bind(
        nowSeconds + POLL_INTERVAL_SECONDS,
        nowSeconds,
        POLLER_ID,
        nowSeconds,
      )
      .run();
    if ((lease.meta?.changes ?? 0) !== 1) {
      return health(true, 0, startedAt, observedAt);
    }

    const signatures = await rpc<SignatureInfo[]>(
      apiKey,
      "getSignaturesForAddress",
      [
        target.primaryPoolAddress,
        { limit: SIGNATURE_LIMIT, commitment: "confirmed" },
      ],
    );
    const recent = (signatures ?? [])
      .filter(
        (item) =>
          item.signature &&
          !item.err &&
          Number(item.blockTime ?? 0) >= nowSeconds - 30 * 60,
      )
      .map((item) => item.signature as string);
    const unknown = await unknownSignatures(database, recent);
    const transactions = await Promise.all(
      unknown.map((signature) =>
        rpc<unknown>(apiKey, "getTransaction", [
          signature,
          {
            commitment: "confirmed",
            encoding: "jsonParsed",
            maxSupportedTransactionVersion: 0,
          },
        ]).then((transaction) => ({ signature, transaction })),
      ),
    );
    const rows = transactions
      .map(({ signature, transaction }) =>
        normalizeTransaction(transaction, signature, target),
      )
      .filter((row): row is NonNullable<typeof row> => Boolean(row));
    if (rows.length > 0) {
      await database.batch(
        rows.map((row) =>
          database
            .prepare(
              `INSERT OR IGNORE INTO trades (
                signature, token_address, symbol, wallet, cluster_id, side,
                amount_usd, price_usd, identity_confidence, bot_score,
                source, timestamp, received_at
              ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            )
            .bind(
              row.signature,
              row.tokenAddress,
              row.symbol,
              row.wallet,
              row.wallet,
              row.side,
              row.amountUsd,
              row.priceUsd,
              0.4,
              0.2,
              "solana-rpc-online-poll",
              row.timestamp,
              nowSeconds,
            ),
        ),
      );
    }
    return health(true, rows.length, startedAt, observedAt);
  } catch (error) {
    return health(
      false,
      0,
      startedAt,
      observedAt,
      error instanceof Error ? error.message.slice(0, 160) : "poll failed",
    );
  }
}

async function unknownSignatures(
  database: D1Database,
  signatures: string[],
) {
  if (signatures.length === 0) return [];
  const placeholders = signatures.map(() => "?").join(",");
  const existing = await database
    .prepare(
      `SELECT signature
       FROM trades
       WHERE signature IN (${placeholders})`,
    )
    .bind(...signatures)
    .all<{ signature: string }>();
  const known = new Set(existing.results.map((row) => row.signature));
  return signatures.filter((signature) => !known.has(signature));
}

function normalizeTransaction(
  value: unknown,
  signature: string,
  candidate: MarketCandidate,
) {
  const transaction = value as {
    blockTime?: number;
    meta?: {
      err?: unknown;
      preTokenBalances?: TokenBalance[];
      postTokenBalances?: TokenBalance[];
    };
    transaction?: {
      message?: {
        accountKeys?: Array<
          string | { pubkey?: string; signer?: boolean }
        >;
      };
    };
  } | null;
  if (!transaction?.meta || transaction.meta.err) return null;
  const timestamp = Number(transaction.blockTime);
  if (!Number.isInteger(timestamp)) return null;

  const accountKeys = transaction.transaction?.message?.accountKeys ?? [];
  const firstSigner = accountKeys.find(
    (account) => typeof account === "object" && account.signer,
  );
  const feePayer =
    typeof firstSigner === "object" && firstSigner.pubkey
      ? firstSigner.pubkey
      : typeof accountKeys[0] === "string"
        ? accountKeys[0]
        : accountKeys[0]?.pubkey;
  const pre = balancesByOwner(
    transaction.meta.preTokenBalances,
    candidate.tokenAddress,
  );
  const post = balancesByOwner(
    transaction.meta.postTokenBalances,
    candidate.tokenAddress,
  );
  const owners = new Set([...pre.keys(), ...post.keys()]);
  const deltas = [...owners]
    .map((owner) => ({
      owner,
      delta: (post.get(owner) ?? 0) - (pre.get(owner) ?? 0),
    }))
    .filter((entry) => Math.abs(entry.delta) > 0)
    .sort((left, right) => Math.abs(right.delta) - Math.abs(left.delta));
  const selected =
    deltas.find((entry) => entry.owner === feePayer) ?? deltas[0];
  if (!selected || candidate.priceUsd <= 0) return null;

  return {
    signature,
    tokenAddress: candidate.tokenAddress,
    symbol: candidate.symbol,
    wallet: selected.owner,
    side: selected.delta > 0 ? ("buy" as const) : ("sell" as const),
    amountUsd: Math.abs(selected.delta) * candidate.priceUsd,
    priceUsd: candidate.priceUsd,
    timestamp,
  };
}

type TokenBalance = {
  mint?: string;
  owner?: string;
  uiTokenAmount?: {
    uiAmountString?: string;
    uiAmount?: number;
  };
};

function balancesByOwner(
  balances: TokenBalance[] | undefined,
  tokenAddress: string,
) {
  const result = new Map<string, number>();
  for (const balance of balances ?? []) {
    if (balance.mint !== tokenAddress || !balance.owner) continue;
    const amount = Number(
      balance.uiTokenAmount?.uiAmountString ??
        balance.uiTokenAmount?.uiAmount ??
        0,
    );
    if (Number.isFinite(amount)) {
      result.set(
        balance.owner,
        (result.get(balance.owner) ?? 0) + amount,
      );
    }
  }
  return result;
}

async function rpc<T>(
  apiKey: string | undefined,
  method: string,
  params: unknown[],
): Promise<T> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const endpoint = apiKey
      ? `https://mainnet.helius-rpc.com/?api-key=${encodeURIComponent(apiKey)}`
      : "https://api.mainnet-beta.solana.com";
    const response = await fetch(
      endpoint,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: `${method}-${Date.now()}`,
          method,
          params,
        }),
        signal: controller.signal,
      },
    );
    if (!response.ok) throw new Error(`Solana RPC HTTP ${response.status}`);
    const payload = (await response.json()) as RpcResponse<T>;
    if (payload.error) {
      throw new Error(payload.error.message ?? `${method} failed`);
    }
    return payload.result as T;
  } finally {
    clearTimeout(timeout);
  }
}

function health(
  ok: boolean,
  records: number,
  startedAt: number,
  observedAt: string,
  error?: string,
): DataSourceHealth {
  return {
    name: "solana-rpc-demand-poll",
    role: "demand",
    ok,
    discoveryOk: true,
    records,
    latencyMs: Date.now() - startedAt,
    observedAt,
    error,
  };
}
