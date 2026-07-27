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
  const rawBody = await request.text();
  try {
    await authenticateIngestRequest({
      request,
      body: rawBody,
      secret: runtimeEnv.INGEST_SECRET,
      database: runtimeEnv.DB,
    });
  } catch (error) {
    if (error instanceof IngestSecurityError) {
      return Response.json({ error: error.message }, { status: error.status });
    }
    return Response.json({ error: "Authentication failed" }, { status: 401 });
  }

  let body: { trades?: TradeInput[] };
  try {
    body = JSON.parse(rawBody) as { trades?: TradeInput[] };
  } catch {
    return Response.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const trades = (body.trades ?? []).slice(0, 100).map(normalizeTrade);
  if (trades.some((trade) => !trade)) {
    return Response.json({ error: "Invalid trade payload" }, { status: 400 });
  }
  if (trades.length === 0) {
    return Response.json({ accepted: 0 });
  }

  const database = runtimeEnv.DB;
  if (!database) {
    return Response.json(
      { error: "Ingestion is not configured" },
      { status: 503 },
    );
  }
  const statements = trades.map((trade) =>
    database.prepare(
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

  await database.batch(statements);
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
  const nowSeconds = Math.floor(Date.now() / 1000);
  const source = input.source?.trim().slice(0, 32) || "";
  const allowedSources = new Set([
    "helius-standard-wss",
    "birdeye-standard-rest",
    "solana-rpc",
  ]);

  if (
    !signature ||
    !/^[1-9A-HJ-NP-Za-km-z]{64,128}$/.test(signature) ||
    !tokenAddress ||
    !/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(tokenAddress) ||
    !symbol ||
    !wallet ||
    !/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(wallet) ||
    (side !== "buy" && side !== "sell") ||
    !Number.isFinite(amountUsd) ||
    amountUsd <= 0 ||
    amountUsd > 10_000_000 ||
    !Number.isInteger(timestamp) ||
    timestamp < nowSeconds - 2 * 60 * 60 ||
    timestamp > nowSeconds + 60 ||
    !allowedSources.has(source)
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
    source,
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
import {
  authenticateIngestRequest,
  IngestSecurityError,
} from "../../../../lib/ingest-security";
