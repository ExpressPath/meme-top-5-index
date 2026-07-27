import {
  buildSnapshot,
  fallbackCandidates,
  type DemandSignal,
  type IndexSnapshot,
} from "../../../lib/index-engine";
import { fetchMarketData } from "../../../lib/market-data";
import { verifySolanaMints } from "../../../lib/solana-verifier";

const SEED_ADDRESSES = fallbackCandidates.map((coin) => coin.tokenAddress);
const SNAPSHOT_TTL_MS = 60_000;

let cachedSnapshot:
  | {
      value: IndexSnapshot;
      expiresAt: number;
    }
  | undefined;
let refreshInFlight: Promise<IndexSnapshot> | undefined;

export async function GET() {
  const now = Date.now();
  if (cachedSnapshot && cachedSnapshot.expiresAt > now) {
    return indexResponse(cachedSnapshot.value);
  }

  refreshInFlight ??= createSnapshot().finally(() => {
    refreshInFlight = undefined;
  });

  try {
    const snapshot = await refreshInFlight;
    cachedSnapshot = {
      value: snapshot,
      expiresAt: Date.now() + SNAPSHOT_TTL_MS,
    };
    return indexResponse(snapshot);
  } catch {
    const fallback = buildSnapshot(
      fallbackCandidates,
      new Date().toISOString(),
      [],
    );
    return indexResponse({
      ...fallback,
      isLive: false,
      dataMode: "fallback",
      identityNotice:
        "外部データ源の合意を確認できないため、検証済み研究スナップショットを表示中",
      publication: {
        ...fallback.publication,
        state: "halted",
        tokenNavEligible: false,
        reasons: ["市場データ取得に失敗したため指数公開を停止しました"],
      },
    });
  }
}

async function createSnapshot() {
  const asOf = new Date().toISOString();
  const runtimeEnv = await getRuntimeEnv();
  const [marketData, demand] = await Promise.all([
    fetchMarketData(SEED_ADDRESSES),
    readDemandSignals(runtimeEnv.DB).catch(
      () => new Map<string, DemandSignal>(),
    ),
  ]);
  const enriched = marketData.candidates.map((coin) => ({
    ...coin,
    demand: demand.get(coin.tokenAddress),
  }));

  if (enriched.length < 5) {
    const fallback = buildSnapshot(
      fallbackCandidates,
      asOf,
      marketData.sources,
    );
    return {
      ...fallback,
      isLive: false,
      dataMode: "fallback" as const,
      identityNotice:
        "採用基準を満たすライブ銘柄が5つ未満のため、研究スナップショットを表示中",
      publication: {
        ...fallback.publication,
        state: "halted" as const,
        tokenNavEligible: false,
        reasons: [
          ...fallback.publication.reasons,
          "ライブ市場データが5銘柄未満です",
        ],
      },
    };
  }

  const preliminary = buildSnapshot(enriched, asOf, marketData.sources);
  const selectedAddresses = new Set(
    preliminary.constituents.map((coin) => coin.tokenAddress),
  );
  const selected = enriched.filter((coin) =>
    selectedAddresses.has(coin.tokenAddress),
  );
  const verification = await verifySolanaMints(
    selected,
    runtimeEnv.HELIUS_API_KEY,
  );
  const verifiedByAddress = new Map(
    verification.candidates.map((coin) => [coin.tokenAddress, coin]),
  );
  const verifiedUniverse = enriched.map(
    (coin) => verifiedByAddress.get(coin.tokenAddress) ?? coin,
  );

  return buildSnapshot(verifiedUniverse, asOf, [
    ...marketData.sources,
    verification.health,
  ]);
}

function indexResponse(snapshot: IndexSnapshot) {
  return Response.json(snapshot, {
    headers: {
      "Cache-Control":
        "public, max-age=5, s-maxage=60, stale-while-revalidate=120",
      "Access-Control-Allow-Origin": "*",
      "X-MT5-Publication-State": snapshot.publication.state,
    },
  });
}

async function readDemandSignals(database?: D1Database) {
  if (!database) return new Map<string, DemandSignal>();

  const cutoff = Math.floor(Date.now() / 1000) - 30 * 60;
  const result = await database.prepare(
    `WITH recent AS (
      SELECT *
      FROM trades
      WHERE timestamp >= ?
        AND timestamp <= ?
    ),
    gross AS (
      SELECT
        token_address,
        SUM(CASE WHEN side = 'buy' THEN amount_usd ELSE 0 END) AS gross_buy_usd
      FROM recent
      GROUP BY token_address
    ),
    clustered AS (
      SELECT
        token_address,
        cluster_id,
        SUM(amount_usd) AS cluster_buy_usd,
        AVG(identity_confidence) AS cluster_confidence
      FROM recent
      WHERE side = 'buy'
        AND bot_score < 0.5
        AND identity_confidence >= 0.65
      GROUP BY token_address, cluster_id
    ),
    qualified AS (
      SELECT
        token_address,
        SUM(MIN(cluster_buy_usd, 10000)) AS qualified_buy_usd,
        COUNT(*) AS estimated_users,
        AVG(cluster_confidence) AS identity_confidence
      FROM clustered
      GROUP BY token_address
    )
    SELECT
      gross.token_address AS tokenAddress,
      gross.gross_buy_usd AS grossBuyUsd,
      COALESCE(qualified.qualified_buy_usd, 0) AS qualifiedBuyUsd,
      COALESCE(qualified.estimated_users, 0) AS estimatedUsers,
      COALESCE(qualified.identity_confidence, 0) AS identityConfidence
    FROM gross
    LEFT JOIN qualified
      ON qualified.token_address = gross.token_address`,
  )
    .bind(cutoff, Math.floor(Date.now() / 1000) + 60)
    .all<DemandSignal>();

  return new Map(result.results.map((row) => [row.tokenAddress, row]));
}

async function getRuntimeEnv(): Promise<{
  DB?: D1Database;
  HELIUS_API_KEY?: string;
}> {
  try {
    const workers = await import("cloudflare:workers");
    const runtime = workers.env as unknown as {
      DB?: D1Database;
      HELIUS_API_KEY?: string;
    };
    return {
      ...runtime,
      HELIUS_API_KEY:
        runtime.HELIUS_API_KEY ?? process.env.HELIUS_API_KEY,
    };
  } catch {
    return { HELIUS_API_KEY: process.env.HELIUS_API_KEY };
  }
}
