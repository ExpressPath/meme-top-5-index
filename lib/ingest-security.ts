export const MAX_INGEST_BODY_BYTES = 256 * 1024;
export const MAX_INGEST_CLOCK_SKEW_SECONDS = 5 * 60;

export class IngestSecurityError extends Error {
  readonly status: number;

  constructor(
    message: string,
    status: number,
  ) {
    super(message);
    this.status = status;
  }
}

export async function authenticateIngestRequest(options: {
  request: Request;
  body: string;
  secret?: string;
  database?: D1Database;
  nowSeconds?: number;
}) {
  const { request, body, secret, database } = options;
  if (!secret || secret.length < 32 || !database) {
    throw new IngestSecurityError("Ingestion is not configured", 503);
  }
  if (!request.headers.get("content-type")?.includes("application/json")) {
    throw new IngestSecurityError("Content-Type must be application/json", 415);
  }
  if (new TextEncoder().encode(body).byteLength > MAX_INGEST_BODY_BYTES) {
    throw new IngestSecurityError("Payload too large", 413);
  }

  const signerId = request.headers.get("x-mt5-signer")?.trim() ?? "";
  const timestampText = request.headers.get("x-mt5-timestamp")?.trim() ?? "";
  const nonce = request.headers.get("x-mt5-nonce")?.trim() ?? "";
  const suppliedSignature =
    request.headers.get("x-mt5-signature")?.trim() ?? "";
  const timestamp = Number(timestampText);
  const nowSeconds =
    options.nowSeconds ?? Math.floor(Date.now() / 1000);

  if (!/^[A-Za-z0-9._-]{3,64}$/.test(signerId)) {
    throw new IngestSecurityError("Invalid signer", 401);
  }
  if (
    !Number.isInteger(timestamp) ||
    Math.abs(nowSeconds - timestamp) > MAX_INGEST_CLOCK_SKEW_SECONDS
  ) {
    throw new IngestSecurityError("Stale request", 401);
  }
  if (!/^[A-Za-z0-9_-]{16,128}$/.test(nonce)) {
    throw new IngestSecurityError("Invalid nonce", 401);
  }
  if (!/^[A-Za-z0-9_-]{43}$/.test(suppliedSignature)) {
    throw new IngestSecurityError("Invalid signature", 401);
  }

  const expectedSignature = await createIngestSignature({
    secret,
    timestamp,
    nonce,
    body,
  });
  if (!timingSafeEqual(suppliedSignature, expectedSignature)) {
    throw new IngestSecurityError("Unauthorized", 401);
  }

  const receivedAt = Math.floor(Date.now() / 1000);
  const result = await database
    .prepare(
      `INSERT OR IGNORE INTO ingest_nonces (
         nonce, signer_id, timestamp, received_at
       ) VALUES (?, ?, ?, ?)`,
    )
    .bind(nonce, signerId, timestamp, receivedAt)
    .run();
  if (!result.meta.changes) {
    throw new IngestSecurityError("Replay detected", 409);
  }

  await database
    .prepare("DELETE FROM ingest_nonces WHERE received_at < ?")
    .bind(receivedAt - 24 * 60 * 60)
    .run()
    .catch(() => undefined);

  return { signerId, timestamp, nonce };
}

export async function createIngestSignature(options: {
  secret: string;
  timestamp: number;
  nonce: string;
  body: string;
}) {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(options.secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const canonical = `${options.timestamp}\n${options.nonce}\n${options.body}`;
  const signature = await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(canonical),
  );
  return base64UrlEncode(new Uint8Array(signature));
}

export async function sha256Base64Url(value: string) {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(value),
  );
  return base64UrlEncode(new Uint8Array(digest));
}

function timingSafeEqual(left: string, right: string) {
  if (left.length !== right.length) return false;
  let difference = 0;
  for (let index = 0; index < left.length; index += 1) {
    difference |= left.charCodeAt(index) ^ right.charCodeAt(index);
  }
  return difference === 0;
}

function base64UrlEncode(value: Uint8Array) {
  let binary = "";
  for (const byte of value) binary += String.fromCharCode(byte);
  return btoa(binary)
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}
