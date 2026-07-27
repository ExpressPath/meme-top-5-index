type TradeInput = {
  signature?: string;
  tokenAddress?: string;
  symbol?: string;
  wallet?: string;
  clusterId?: string;
  side?: "buy" | "sell";
  amountUsd?: number;
  priceUsd?: number;
  identityConfidence?: number;
  botScore?: number;
  source?: string;
  timestamp?: number;
};

export async function POST(request: Request) {
  const runtimeEnv = await getRuntimeEnv();
  const expectedSecret = runtimeEnv.INGEST_SECRET;
  const suppliedSecret = request.headers
    .get("authorization")
    ?.replace(/^Bearer\s+/i, "");

  if (!runtimeEnv.DB || !expectedSecret) {
    return Response.json(
      { error: "Ingestion is not configured" },
      { status: 503 },
    );
  }
  if (!suppliedSecret || suppliedSecret !== expectedSecret) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = (await request.json()) as { trades?: TradeInput[] };
  const trades = (body.trades ?? []).slice(0, 100).map(normalizeTrade);
  if (trades.some((trade) => !trade)) {
    return Response.json({ error: "Invalid trade payload" }, { status: 400 });
  }
  if (trades.length === 0) {
    return Response.json({ accepted: 0 });
  }

  const statements = trades.map((trade) =>
    runtimeEnv.DB!.prepare(
      `INSERT OR IGNORE INTO trades (
        signature, token_address, symbol, wallet, cluster_id, side,
        amount_usd, price_usd, identity_confidence, bot_score,
        source, timestamp, received_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).bind(
      trade!.signature,
      trade!.tokenAddress,
      trade!.symbol,
      trade!.wallet,
      trade!.clusterId,
      trade!.side,
      trade!.amountUsd,
      trade!.priceUsd,
      trade!.identityConfidence,
      trade!.botScore,
      trade!.source,
      trade!.timestamp,
      Math.floor(Date.now() / 1000),
    ),
  );

  await runtimeEnv.DB.batch(statements);
  return Response.json({ accepted: statements.length }, { status: 202 });
}

async function getRuntimeEnv(): Promise<{
    DB?: D1Database;
    INGEST_SECRET?: string;
}> {
  try {
    const workers = await import("cloudflare:workers");
    return workers.env as unknown as {
      DB?: D1Database;
      INGEST_SECRET?: string;
    };
  } catch {
    return {};
  }
}

function normalizeTrade(input: TradeInput) {
  const signature = input.signature?.trim();
  const tokenAddress = input.tokenAddress?.trim();
  const symbol = input.symbol?.trim().slice(0, 16);
  const wallet = input.wallet?.trim();
  const side = input.side;
  const amountUsd = Number(input.amountUsd);
  const timestamp = Number(input.timestamp);

  if (
    !signature ||
    !tokenAddress ||
    !symbol ||
    !wallet ||
    (side !== "buy" && side !== "sell") ||
    !Number.isFinite(amountUsd) ||
    amountUsd <= 0 ||
    !Number.isInteger(timestamp)
  ) {
    return null;
  }

  return {
    signature,
    tokenAddress,
    symbol,
    wallet,
    clusterId: input.clusterId?.trim() || wallet,
    side,
    amountUsd,
    priceUsd: finiteOrNull(input.priceUsd),
    identityConfidence: clamp(Number(input.identityConfidence ?? 0), 0, 1),
    botScore: clamp(Number(input.botScore ?? 0), 0, 1),
    source: input.source?.trim().slice(0, 32) || "unknown",
    timestamp,
  };
}

function finiteOrNull(value: unknown) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, Number.isFinite(value) ? value : min));
}
