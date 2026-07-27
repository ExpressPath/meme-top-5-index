export async function GET() {
  const runtimeEnv = await getRuntimeEnv();
  const externalOracleKeys = parsePublicKeys(
    runtimeEnv.ORACLE_ATTESTER_PUBLIC_KEYS,
  );
  return Response.json(
    {
      snapshotSigning: {
        algorithm: "Ed25519",
        keyId: runtimeEnv.SNAPSHOT_SIGNING_KEY_ID ?? "mt5-index-1",
        publicKeyRawBase64:
          runtimeEnv.SNAPSHOT_SIGNING_PUBLIC_KEY ?? null,
        signedEndpoint: "/api/index",
        signatureHeader: "X-MT5-Signature",
        digestHeader: "Content-Digest",
      },
      externalOracleAttestations: {
        algorithm: "Ed25519",
        required: 2,
        configured: externalOracleKeys.length,
        keys: externalOracleKeys,
        submissionEndpoint: "/api/ingest/oracle-attestations",
        lookupEndpoint: "/api/oracle-attestations?digest=<content-digest>",
      },
      writeBoundary: {
        authentication: "HMAC-SHA256",
        replayWindowSeconds: 300,
        nonceRetentionSeconds: 86400,
        maximumPayloadBytes: 262144,
        rateLimit: "60 requests per minute per signer",
      },
      failClosed: [
        "unauthenticated cron requests cannot refresh upstream data",
        "stale or replayed writes are rejected",
        "token NAV stops when source, identity, chain, or reserve gates fail",
        "mainnet issuance remains disabled until custody, audit, and legal approval",
      ],
    },
    {
      headers: {
        "Cache-Control": "public, max-age=300, s-maxage=3600",
        "Access-Control-Allow-Origin": "*",
      },
    },
  );
}

async function getRuntimeEnv(): Promise<{
  SNAPSHOT_SIGNING_PUBLIC_KEY?: string;
  SNAPSHOT_SIGNING_KEY_ID?: string;
  ORACLE_ATTESTER_PUBLIC_KEYS?: string;
}> {
  try {
    const workers = await import("cloudflare:workers");
    return workers.env as unknown as {
      SNAPSHOT_SIGNING_PUBLIC_KEY?: string;
      SNAPSHOT_SIGNING_KEY_ID?: string;
      ORACLE_ATTESTER_PUBLIC_KEYS?: string;
    };
  } catch {
    return {
      SNAPSHOT_SIGNING_PUBLIC_KEY:
        process.env.SNAPSHOT_SIGNING_PUBLIC_KEY,
      SNAPSHOT_SIGNING_KEY_ID: process.env.SNAPSHOT_SIGNING_KEY_ID,
      ORACLE_ATTESTER_PUBLIC_KEYS:
        process.env.ORACLE_ATTESTER_PUBLIC_KEYS,
    };
  }
}

function parsePublicKeys(value?: string) {
  if (!value) return [];
  try {
    return Object.entries(JSON.parse(value) as Record<string, string>)
      .filter(
        ([keyId, publicKeyRawBase64]) =>
          /^[A-Za-z0-9._-]{3,64}$/.test(keyId) &&
          /^[A-Za-z0-9+/]{43}=$/.test(publicKeyRawBase64),
      )
      .map(([keyId, publicKeyRawBase64]) => ({
        keyId,
        publicKeyRawBase64,
      }));
  } catch {
    return [];
  }
}
