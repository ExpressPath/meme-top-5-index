export async function signSnapshotBody(
  body: string,
  privateKeyPkcs8Base64?: string,
) {
  const bytes = new TextEncoder().encode(body);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  if (!privateKeyPkcs8Base64) {
    return {
      digest: `sha-256=${base64UrlEncode(new Uint8Array(digest))}`,
      signature: null,
    };
  }

  const privateKey = await crypto.subtle.importKey(
    "pkcs8",
    base64Decode(privateKeyPkcs8Base64),
    { name: "Ed25519" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign("Ed25519", privateKey, bytes);
  return {
    digest: `sha-256=${base64UrlEncode(new Uint8Array(digest))}`,
    signature: base64UrlEncode(new Uint8Array(signature)),
  };
}

export async function verifySnapshotBody(
  body: string,
  signatureBase64Url: string,
  publicKeyRawBase64: string,
) {
  const publicKey = await crypto.subtle.importKey(
    "raw",
    base64Decode(publicKeyRawBase64),
    { name: "Ed25519" },
    false,
    ["verify"],
  );
  return crypto.subtle.verify(
    "Ed25519",
    publicKey,
    base64UrlDecode(signatureBase64Url),
    new TextEncoder().encode(body),
  );
}

function base64Decode(value: string) {
  return Uint8Array.from(atob(value), (character) => character.charCodeAt(0));
}

function base64UrlDecode(value: string) {
  return base64Decode(
    value.replace(/-/g, "+").replace(/_/g, "/").padEnd(
      Math.ceil(value.length / 4) * 4,
      "=",
    ),
  );
}

function base64UrlEncode(value: Uint8Array) {
  let binary = "";
  for (const byte of value) binary += String.fromCharCode(byte);
  return btoa(binary)
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}
