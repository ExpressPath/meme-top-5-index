import {
  buildBackingPlan,
  evaluateReserveReport,
  type ReserveReport,
} from "../../../lib/backing-engine";
import { readLatestIndexSnapshot } from "../../../lib/index-store";
import { fallbackSnapshot } from "../../../lib/index-engine";

type QuorumRow = {
  reportId: string;
  bodyHash: string;
  payload: string;
  signerCount: number;
  signers: string;
  latestReceivedAt: number;
};

export async function GET() {
  const runtimeEnv = await getRuntimeEnv();
  const snapshot =
    (await readLatestIndexSnapshot(runtimeEnv.DB).catch(() => null)) ??
    fallbackSnapshot;
  const plan = buildBackingPlan(snapshot);
  const quorum = await readLatestReserveQuorum(runtimeEnv.DB).catch(
    () => null,
  );

  if (!quorum) {
    return Response.json(
      {
        asOf: snapshot.asOf,
        status: "unconfigured",
        releaseEligible: false,
        attestationQuorum: { required: 2, observed: 0, signers: [] },
        plan,
        reserve: null,
        reasons: [
          "実保管資産の署名済みレポートが2者から届いていません",
          "カストディ接続と法務承認が完了するまで発行・入金は停止します",
        ],
      },
      { headers: publicCacheHeaders() },
    );
  }

  const report = JSON.parse(quorum.payload) as ReserveReport;
  const reserve = evaluateReserveReport(snapshot, report);
  const signers = quorum.signers.split(",").filter(Boolean);
  const releaseEligible =
    quorum.signerCount >= 2 &&
    reserve.ready &&
    snapshot.publication.tokenNavEligible;

  return Response.json(
    {
      asOf: snapshot.asOf,
      status: releaseEligible ? "ready" : "blocked",
      releaseEligible,
      attestationQuorum: {
        required: 2,
        observed: quorum.signerCount,
        signers,
        reportId: quorum.reportId,
        bodyHash: quorum.bodyHash,
        receivedAt: new Date(quorum.latestReceivedAt * 1000).toISOString(),
      },
      plan,
      reserve,
      reasons: releaseEligible
        ? []
        : [
            ...reserve.reasons,
            ...(!snapshot.publication.tokenNavEligible
              ? ["指数側のNAV公開条件が未達です"]
              : []),
          ],
    },
    { headers: publicCacheHeaders() },
  );
}

async function readLatestReserveQuorum(database?: D1Database) {
  if (!database) return null;
  return database
    .prepare(
      `SELECT
         report_id AS reportId,
         body_hash AS bodyHash,
         payload,
         COUNT(DISTINCT signer_id) AS signerCount,
         GROUP_CONCAT(DISTINCT signer_id) AS signers,
         MAX(received_at) AS latestReceivedAt
       FROM reserve_reports
       WHERE as_of >= ?
       GROUP BY report_id, body_hash, payload
       HAVING COUNT(DISTINCT signer_id) >= 2
       ORDER BY as_of DESC, latestReceivedAt DESC
       LIMIT 1`,
    )
    .bind(Math.floor(Date.now() / 1000) - 24 * 60 * 60)
    .first<QuorumRow>();
}

function publicCacheHeaders() {
  return {
    "Cache-Control": "public, max-age=5, s-maxage=60",
    "Access-Control-Allow-Origin": "*",
  };
}

async function getRuntimeEnv(): Promise<{ DB?: D1Database }> {
  try {
    const workers = await import("cloudflare:workers");
    return workers.env as unknown as { DB?: D1Database };
  } catch {
    return {};
  }
}
