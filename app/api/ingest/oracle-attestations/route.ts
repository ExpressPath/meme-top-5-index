import { verifySnapshotBody } from "../../../../lib/snapshot-integrity";

type OracleAttestationInput = {
  digest?: string;
  keyId?: string;
  signature?: string;
  asOf?: number;
};

export async function POST(request: Request) {
  const runtimeEnv = await getRuntimeEnv();
  if (!runtimeEnv.DB) {
    return Response.json(
      { error: "Oracle attestation storage is not configured" },
      { status: 503 },
    );
  }
  if (!request.headers.get("content-type")?.includes("application/json")) {
    return Response.json(
      { error: "Content-Type must be application/json" },
      { status: 415 },
    );
  }
  const rawBody = await request.text();
  if (new TextEncoder().encode(rawBody).byteLength > 16 * 1024) {
    return Response.json({ error: "Payload too large" }, { status: 413 });
  }

  let input: OracleAttestationInput;
  try {
    input = JSON.parse(rawBody) as OracleAttestationInput;
  } catch {
    return Response.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const digest = input.digest?.trim() ?? "";
  const keyId = input.keyId?.trim() ?? "";
  const signature = input.signature?.trim() ?? "";
  const asOf = Number(input.asOf);
  const nowSeconds = Math.floor(Date.now() / 1000);
  const publicKeys = parsePublicKeys(
    runtimeEnv.ORACLE_ATTESTER_PUBLIC_KEYS,
  );
  const publicKey = publicKeys.get(keyId);

  if (
    !/^sha-256=[A-Za-z0-9_-]{43}$/.test(digest) ||
    !/^[A-Za-z0-9._-]{3,64}$/.test(keyId) ||
    !/^[A-Za-z0-9_-]{86}$/.test(signature) ||
    !Number.isInteger(asOf) ||
    Math.abs(nowSeconds - asOf) > 5 * 60 ||
    !publicKey
  ) {
    return Response.json({ error: "Invalid attestation" }, { status: 400 });
  }

  const message = `${digest}\n${asOf}`;
  const valid = await verifySnapshotBody(message, signature, publicKey).catch(
    () => false,
  );
  if (!valid) {
    return Response.json({ error: "Invalid signature" }, { status: 401 });
  }

  await runtimeEnv.DB.prepare(
    `INSERT OR REPLACE INTO oracle_attestations (
       digest, key_id, signature, as_of, received_at
     ) VALUES (?, ?, ?, ?, ?)`,
  )
    .bind(digest, keyId, signature, asOf, nowSeconds)
    .run();
  await runtimeEnv.DB.prepare(
    "DELETE FROM oracle_attestations WHERE received_at < ?",
  )
    .bind(nowSeconds - 24 * 60 * 60)
    .run();

  return Response.json(
    { accepted: true, digest, keyId, asOf },
    { status: 202 },
  );
}

function parsePublicKeys(value?: string) {
  if (!value) return new Map<string, string>();
  try {
    const parsed = JSON.parse(value) as Record<string, string>;
    return new Map(
      Object.entries(parsed).filter(
        ([keyId, publicKey]) =>
          /^[A-Za-z0-9._-]{3,64}$/.test(keyId) &&
          /^[A-Za-z0-9+/]{43}=$/.test(publicKey),
      ),
    );
  } catch {
    return new Map<string, string>();
  }
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
