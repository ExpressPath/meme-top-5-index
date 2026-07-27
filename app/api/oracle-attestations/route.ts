export async function GET(request: Request) {
  const runtimeEnv = await getRuntimeEnv();
  const digest = new URL(request.url).searchParams.get("digest")?.trim() ?? "";
  if (!/^sha-256=[A-Za-z0-9_-]{43}$/.test(digest)) {
    return Response.json({ error: "Invalid digest" }, { status: 400 });
  }
  if (!runtimeEnv.DB) {
    return Response.json(
      { digest, required: 2, observed: 0, attestations: [] },
      { status: 503 },
    );
  }
  const activeKeyIds = new Set(
    Object.keys(parsePublicKeys(runtimeEnv.ORACLE_ATTESTER_PUBLIC_KEYS)),
  );
  const result = await runtimeEnv.DB.prepare(
    `SELECT
       key_id AS keyId,
       signature,
       as_of AS asOf,
       received_at AS receivedAt
     FROM oracle_attestations
     WHERE digest = ?
       AND received_at >= ?
     ORDER BY key_id`,
  )
    .bind(digest, Math.floor(Date.now() / 1000) - 5 * 60)
    .all<{
      keyId: string;
      signature: string;
      asOf: number;
      receivedAt: number;
    }>();
  const activeAttestations = result.results.filter((row) =>
    activeKeyIds.has(row.keyId),
  );
  return Response.json(
    {
      digest,
      required: 2,
      observed: activeAttestations.length,
      ready: activeAttestations.length >= 2,
      attestations: activeAttestations.map((row) => ({
        ...row,
        asOf: new Date(row.asOf * 1000).toISOString(),
        receivedAt: new Date(row.receivedAt * 1000).toISOString(),
      })),
    },
    {
      headers: {
        "Cache-Control": "public, max-age=5, s-maxage=15",
        "Access-Control-Allow-Origin": "*",
      },
    },
  );
}

type RuntimeEnv = {
  DB?: D1Database;
  ORACLE_ATTESTER_PUBLIC_KEYS?: string;
};

async function getRuntimeEnv(): Promise<RuntimeEnv> {
  try {
    const workers = await import("cloudflare:workers");
    return workers.env as unknown as RuntimeEnv;
  } catch {
    return {
      ORACLE_ATTESTER_PUBLIC_KEYS:
        process.env.ORACLE_ATTESTER_PUBLIC_KEYS,
    };
  }
}

function parsePublicKeys(value?: string) {
  if (!value) return {};
  try {
    return JSON.parse(value) as Record<string, string>;
  } catch {
    return {};
  }
}
