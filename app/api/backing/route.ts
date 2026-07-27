import {
  buildBackingPlan,
  evaluateReserveReport,
  type ReserveReport,
} from "../../../lib/backing-engine";
import { readLatestIndexSnapshot } from "../../../lib/index-store";
import { fallbackSnapshot } from "../../../lib/index-engine";
import {
  compareReserveReports,
  verifyOnchainVault,
} from "../../../lib/vault-verifier";

type QuorumRow = {
  reportId: string;
  bodyHash: string;
  payload: string;
  signerCount: number;
  signers: string;
  latestReceivedAt: number;
};

type RuntimeEnv = {
  DB?: D1Database;
  HELIUS_API_KEY?: string;
  MT5_VAULT_OWNER_ADDRESS?: string;
  MT5_MULTISIG_ADDRESS?: string;
  MT5_SHARE_MINT_ADDRESS?: string;
  MT5_FREEZE_AUTHORITY_ADDRESS?: string;
  MT5_CASH_MINT_ADDRESS?: string;
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
  const onchain = await verifyOnchainVault(snapshot, {
    ownerAddress: runtimeEnv.MT5_VAULT_OWNER_ADDRESS,
    multisigAddress: runtimeEnv.MT5_MULTISIG_ADDRESS,
    shareMintAddress: runtimeEnv.MT5_SHARE_MINT_ADDRESS,
    freezeAuthorityAddress: runtimeEnv.MT5_FREEZE_AUTHORITY_ADDRESS,
    cashMintAddress: runtimeEnv.MT5_CASH_MINT_ADDRESS,
    heliusApiKey: runtimeEnv.HELIUS_API_KEY,
  });
  const onchainReserve = onchain.report
    ? evaluateReserveReport(snapshot, onchain.report)
    : null;

  if (!quorum) {
    const reasons = [
      ...onchain.reasons,
      "実保管資産の署名済みレポートが2者から届いていません",
      "カストディ接続と法務承認が完了するまで発行・入金は停止します",
    ];
    return Response.json(
      {
        asOf: snapshot.asOf,
        status: onchain.configured ? "blocked" : "unconfigured",
        releaseEligible: false,
        attestationQuorum: { required: 2, observed: 0, signers: [] },
        plan,
        reserve: null,
        onchain: {
          ...onchain,
          report: undefined,
          reserve: onchainReserve,
        },
        reconciliation: null,
        reasons,
      },
      { headers: publicCacheHeaders() },
    );
  }

  const report = JSON.parse(quorum.payload) as ReserveReport;
  const reserve = evaluateReserveReport(snapshot, report);
  const reconciliation = onchain.report
    ? compareReserveReports(report, onchain.report)
    : null;
  const signers = quorum.signers.split(",").filter(Boolean);
  const releaseEligible =
    quorum.signerCount >= 2 &&
    reserve.ready &&
    snapshot.publication.tokenNavEligible &&
    onchain.verified &&
    onchainReserve?.ready === true &&
    reconciliation?.matches === true;

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
      onchain: {
        ...onchain,
        report: undefined,
        reserve: onchainReserve,
      },
      reconciliation,
      reasons: releaseEligible
        ? []
        : [
            ...reserve.reasons,
            ...onchain.reasons,
            ...(reconciliation && !reconciliation.matches
              ? ["署名済み準備資産報告がオンチェーン残高と一致しません"]
              : []),
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

async function getRuntimeEnv(): Promise<RuntimeEnv> {
  try {
    const workers = await import("cloudflare:workers");
    return workers.env as unknown as RuntimeEnv;
  } catch {
    return {
      HELIUS_API_KEY: process.env.HELIUS_API_KEY,
      MT5_VAULT_OWNER_ADDRESS: process.env.MT5_VAULT_OWNER_ADDRESS,
      MT5_MULTISIG_ADDRESS: process.env.MT5_MULTISIG_ADDRESS,
      MT5_SHARE_MINT_ADDRESS: process.env.MT5_SHARE_MINT_ADDRESS,
      MT5_FREEZE_AUTHORITY_ADDRESS:
        process.env.MT5_FREEZE_AUTHORITY_ADDRESS,
      MT5_CASH_MINT_ADDRESS: process.env.MT5_CASH_MINT_ADDRESS,
    };
  }
}
