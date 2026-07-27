import {
  authenticateIngestRequest,
  IngestSecurityError,
  sha256Base64Url,
} from "../../../../lib/ingest-security";
import type { ReserveReport } from "../../../../lib/backing-engine";

type ReserveReportInput = Partial<ReserveReport>;

export async function POST(request: Request) {
  const runtimeEnv = await getRuntimeEnv();
  const rawBody = await request.text();
  const signerId = request.headers.get("x-mt5-signer")?.trim() ?? "";
  const signerSecrets = parseSignerSecrets(runtimeEnv.RESERVE_SIGNER_SECRETS);

  try {
    await authenticateIngestRequest({
      request,
      body: rawBody,
      secret: signerSecrets.get(signerId),
      database: runtimeEnv.DB,
    });
  } catch (error) {
    if (error instanceof IngestSecurityError) {
      return Response.json({ error: error.message }, { status: error.status });
    }
    return Response.json({ error: "Authentication failed" }, { status: 401 });
  }

  let input: ReserveReportInput;
  try {
    input = JSON.parse(rawBody) as ReserveReportInput;
  } catch {
    return Response.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const report = normalizeReserveReport(input);
  if (!report) {
    return Response.json(
      { error: "Invalid reserve report" },
      { status: 400 },
    );
  }

  const payload = JSON.stringify(report);
  const bodyHash = await sha256Base64Url(payload);
  try {
    await runtimeEnv.DB!.prepare(
      `INSERT INTO reserve_reports (
         report_id, signer_id, sequence, as_of, mode, source,
         payload, body_hash, received_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
      .bind(
        report.reportId,
        signerId,
        report.sequence,
        report.asOf,
        report.mode,
        report.source,
        payload,
        bodyHash,
        Math.floor(Date.now() / 1000),
      )
      .run();
  } catch {
    return Response.json(
      { error: "Duplicate report or non-increasing signer sequence" },
      { status: 409 },
    );
  }

  return Response.json(
    { accepted: true, reportId: report.reportId, signerId, bodyHash },
    { status: 202 },
  );
}

function normalizeReserveReport(
  input: ReserveReportInput,
): ReserveReport | null {
  const reportId = input.reportId?.trim();
  const sequence = Number(input.sequence);
  const asOf = Number(input.asOf);
  const mode = input.mode;
  const source = input.source?.trim().slice(0, 64);
  const tokenSupply = Number(input.tokenSupply);
  const cashUsd = Number(input.cashUsd);
  const liabilitiesUsd = Number(input.liabilitiesUsd);
  const nowSeconds = Math.floor(Date.now() / 1000);
  const holdings = Array.isArray(input.holdings)
    ? input.holdings.map((holding) => ({
        tokenAddress: holding.tokenAddress?.trim() ?? "",
        quantity: Number(holding.quantity),
      }))
    : [];

  if (
    !reportId ||
    !/^[A-Za-z0-9._-]{8,96}$/.test(reportId) ||
    !Number.isSafeInteger(sequence) ||
    sequence < 1 ||
    !Number.isInteger(asOf) ||
    asOf < nowSeconds - 48 * 60 * 60 ||
    asOf > nowSeconds + 60 ||
    (mode !== "shadow" && mode !== "custodied") ||
    !source ||
    !Number.isFinite(tokenSupply) ||
    tokenSupply <= 0 ||
    !Number.isFinite(cashUsd) ||
    cashUsd < 0 ||
    !Number.isFinite(liabilitiesUsd) ||
    liabilitiesUsd < 0 ||
    holdings.length !== 5 ||
    holdings.some(
      (holding) =>
        !/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(holding.tokenAddress) ||
        !Number.isFinite(holding.quantity) ||
        holding.quantity < 0,
    ) ||
    new Set(holdings.map((holding) => holding.tokenAddress)).size !== 5
  ) {
    return null;
  }

  return {
    reportId,
    sequence,
    asOf,
    mode,
    source,
    tokenSupply,
    cashUsd,
    liabilitiesUsd,
    holdings: [...holdings].sort((left, right) =>
      left.tokenAddress.localeCompare(right.tokenAddress),
    ),
  };
}

function parseSignerSecrets(value?: string) {
  if (!value) return new Map<string, string>();
  try {
    const parsed = JSON.parse(value) as Record<string, string>;
    return new Map(
      Object.entries(parsed).filter(
        ([signer, secret]) =>
          /^[A-Za-z0-9._-]{3,64}$/.test(signer) &&
          typeof secret === "string" &&
          secret.length >= 32,
      ),
    );
  } catch {
    return new Map<string, string>();
  }
}

async function getRuntimeEnv(): Promise<{
  DB?: D1Database;
  RESERVE_SIGNER_SECRETS?: string;
}> {
  try {
    const workers = await import("cloudflare:workers");
    return workers.env as unknown as {
      DB?: D1Database;
      RESERVE_SIGNER_SECRETS?: string;
    };
  } catch {
    return { RESERVE_SIGNER_SECRETS: process.env.RESERVE_SIGNER_SECRETS };
  }
}
