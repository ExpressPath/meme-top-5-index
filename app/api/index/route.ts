import { fetchDemandSignals } from "../../../lib/demand-data";
import {
  buildSnapshot,
  fallbackCandidates,
  type DemandSignal,
  type IndexSnapshot,
} from "../../../lib/index-engine";
import { pollRpcDemand } from "../../../lib/rpc-demand";
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

export async function GET(request: Request) {
  const now = Date.now();
  const scheduledRefresh = request.headers.has("x-mt5-cron");
  if (!scheduledRefresh && cachedSnapshot && cachedSnapshot.expiresAt > now) {
    return indexResponse(cachedSnapshot.value, "HIT");
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
    return indexResponse(snapshot, "MISS");
  } catch {
    const fallback = buildSnapshot(
      fallbackCandidates,
      new Date().toISOString(),
      [],
    );
    return indexResponse(
      {
        ...fallback,
        isLive: false,
        dataMode: "fallback",
        identityNotice:
          "外部データ源との接続を確認できないため、検証用スナップショットを表示しています",
        publication: {
          ...fallback.publication,
          state: "halted",
          tokenNavEligible: false,
          reasons: ["市場データ取得に失敗したため指数公開を停止しました"],
        },
      },
      "ERROR",
    );
  }
}

async function createSnapshot() {
  const asOf = new Date();
  const runtimeEnv = await getRuntimeEnv();
  const marketData = await fetchMarketData(SEED_ADDRESSES);
  const prePollSnapshot = buildSnapshot(
    marketData.candidates,
    asOf.toISOString(),
    marketData.sources,
  );
  const pollHealth = await pollRpcDemand({
    database: runtimeEnv.DB,
    apiKey: runtimeEnv.HELIUS_API_KEY,
    candidates: prePollSnapshot.constituents,
    now: asOf,
  }).catch(() => null);
  const persistedDemand = await readDemandSignals(runtimeEnv.DB).catch(
    () => new Map<string, DemandSignal>(),
  );

  const candidatesWithStoredDemand = marketData.candidates.map((coin) => ({
    ...coin,
    demand:
      chooseDemandSignal(coin.demand, persistedDemand.get(coin.tokenAddress)),
  }));
  const preliminary = buildSnapshot(
    candidatesWithStoredDemand,
    asOf.toISOString(),
    [...marketData.sources, ...(pollHealth ? [pollHealth] : [])],
  );
  const preliminaryAddresses = new Set(
    preliminary.constituents.map((coin) => coin.tokenAddress),
  );
  const demandTargets = candidatesWithStoredDemand.filter((coin) =>
    preliminaryAddresses.has(coin.tokenAddress),
  );
  const demandBundle = await fetchDemandSignals(demandTargets, asOf).catch(
    () => null,
  );
  const enriched = candidatesWithStoredDemand.map((coin) => ({
    ...coin,
    demand: chooseDemandSignal(
      coin.demand,
      demandBundle?.signals.get(coin.tokenAddress),
    ),
  }));

  if (enriched.length < 5) {
    const fallback = buildSnapshot(
      fallbackCandidates,
      asOf.toISOString(),
      marketData.sources,
    );
    return {
      ...fallback,
      isLive: false,
      dataMode: "fallback" as const,
      identityNotice:
        "採用基準を満たすライブ銘柄が5つ未満のため、検証用スナップショットを表示しています",
      publication: {
        ...fallback.publication,
        state: "halted" as const,
        tokenNavEligible: false,
        reasons: [
          ...fallback.publication.reasons,
          "ライブ市場データが銘柄選定に不足しています",
        ],
      },
    };
  }

  const selectedBeforeVerification = buildSnapshot(
    enriched,
    asOf.toISOString(),
    [
      ...marketData.sources,
      ...(pollHealth ? [pollHealth] : []),
      ...(demandBundle ? [demandBundle.health] : []),
    ],
  );
  const selectedAddresses = new Set(
    selectedBeforeVerification.constituents.map((coin) => coin.tokenAddress),
  );
  const verification = await verifySolanaMints(
    enriched.filter((coin) => selectedAddresses.has(coin.tokenAddress)),
    runtimeEnv.HELIUS_API_KEY,
  );
  const verifiedByAddress = new Map(
    verification.candidates.map((coin) => [coin.tokenAddress, coin]),
  );
  const verifiedUniverse = enriched.map(
    (coin) => verifiedByAddress.get(coin.tokenAddress) ?? coin,
  );

  return buildSnapshot(verifiedUniverse, asOf.toISOString(), [
    ...marketData.sources,
    ...(pollHealth ? [pollHealth] : []),
    ...(demandBundle ? [demandBundle.health] : []),
    verification.health,
  ]);
}

function chooseDemandSignal(
  first: DemandSignal | undefined,
  second: DemandSignal | undefined,
) {
  if (!first) return second;
  if (!second) return first;
  if (second.identityConfidence > first.identityConfidence) return second;
  if (
    second.identityConfidence === first.identityConfidence &&
    second.coverageComplete &&
    !first.coverageComplete
  ) {
    return second;
  }
  if (
    second.identityConfidence === first.identityConfidence &&
    second.coverageComplete === first.coverageComplete &&
    second.observedTrades > first.observedTrades
  ) {
    return second;
  }
  return first;
}

function indexResponse(
  snapshot: IndexSnapshot,
  cacheStatus: "HIT" | "MISS" | "ERROR",
) {
  return Response.json(snapshot, {
    headers: {
      "Cache-Control":
        "public, max-age=5, s-maxage=60, stale-while-revalidate=180",
      "Access-Control-Allow-Origin": "*",
      "X-MT5-Publication-State": snapshot.publication.state,
      "X-MT5-Cache": cacheStatus,
    },
  });
}

async function readDemandSignals(database?: D1Database) {
  if (!database) return new Map<string, DemandSignal>();

  const cutoff = Math.floor(Date.now() / 1000) - 30 * 60;
  const result = await database
    .prepare(
      `WITH recent AS (
        SELECT *
        FROM trades
        WHERE timestamp >= ?
          AND timestamp <= ?
      ),
      gross AS (
        SELECT
          token_address,
          SUM(CASE WHEN side = 'buy' THEN amount_usd ELSE 0 END) AS gross_buy_usd,
          COUNT(DISTINCT CASE WHEN side = 'buy' THEN wallet END) AS observed_wallets,
          COUNT(DISTINCT CASE WHEN side = 'buy' THEN signature END) AS observed_trades
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
        gross.observed_wallets AS observedBuyerWallets,
        COALESCE(qualified.estimated_users, 0) AS estimatedUsers,
        COALESCE(qualified.identity_confidence, 0) AS identityConfidence,
        gross.observed_trades AS observedTrades
      FROM gross
      LEFT JOIN qualified
        ON qualified.token_address = gross.token_address`,
    )
    .bind(cutoff, Math.floor(Date.now() / 1000) + 60)
    .all<
      Omit<
        DemandSignal,
        "coverageComplete" | "filteredWallets" | "source"
      >
    >();

  return new Map(
    result.results.map((row) => [
      row.tokenAddress,
      {
        ...row,
        coverageComplete: false,
        filteredWallets: Math.max(
          0,
          row.observedBuyerWallets - row.estimatedUsers,
        ),
        source: "solana-rpc-d1",
      },
    ]),
  );
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
