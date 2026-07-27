export async function GET() {
  const runtimeEnv = await getRuntimeEnv();
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
}> {
  try {
    const workers = await import("cloudflare:workers");
    return workers.env as unknown as {
      SNAPSHOT_SIGNING_PUBLIC_KEY?: string;
      SNAPSHOT_SIGNING_KEY_ID?: string;
    };
  } catch {
    return {
      SNAPSHOT_SIGNING_PUBLIC_KEY:
        process.env.SNAPSHOT_SIGNING_PUBLIC_KEY,
      SNAPSHOT_SIGNING_KEY_ID: process.env.SNAPSHOT_SIGNING_KEY_ID,
    };
  }
}
