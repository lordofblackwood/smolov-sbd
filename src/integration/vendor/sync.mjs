import { validateSnapshot } from "./history.mjs";
export const SYNC_ENDPOINT = "https://powerlevel-sync.micak27.chatgpt.site";
export const PAIRING_KEY = "powerlevel:pairing:v1";
const b64 = (bytes) => {
  let binary = "";
  for (let i = 0; i < bytes.length; i += 32768)
    binary += String.fromCharCode(...bytes.subarray(i, i + 32768));
  return btoa(binary)
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replaceAll("=", "");
};
const unb64 = (text) =>
  Uint8Array.from(atob(text.replaceAll("-", "+").replaceAll("_", "/")), (c) =>
    c.charCodeAt(0),
  );
export function newCode() {
  return `pl1_${b64(crypto.getRandomValues(new Uint8Array(32)))}`;
}
export function cleanCode(text) {
  const code = String(text).trim();
  if (!/^pl1_[\w-]{43}$/.test(code))
    throw new Error("Paste the complete connection code from Powerlevel.");
  const bytes = unb64(code.slice(4));
  if (bytes.length !== 32 || `pl1_${b64(bytes)}` !== code)
    throw new Error("That connection code is invalid.");
  return code;
}
async function keyFor(code) {
  return crypto.subtle.importKey(
    "raw",
    unb64(cleanCode(code).slice(4)),
    "AES-GCM",
    false,
    ["encrypt", "decrypt"],
  );
}
export async function authFor(code) {
  const hash = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(`powerlevel-auth:${cleanCode(code)}`),
  );
  return [...new Uint8Array(hash)]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}
export async function encryptSnapshot(code, snapshot) {
  validateSnapshot(snapshot, snapshot.source);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const data = new TextEncoder().encode(JSON.stringify(snapshot));
  const cipher = await crypto.subtle.encrypt(
    {
      name: "AES-GCM",
      iv,
      additionalData: new TextEncoder().encode(snapshot.source),
    },
    await keyFor(code),
    data,
  );
  return { version: 1, iv: b64(iv), ciphertext: b64(new Uint8Array(cipher)) };
}
export async function decryptSnapshot(code, envelope, source) {
  if (
    envelope?.version !== 1 ||
    typeof envelope.iv !== "string" ||
    typeof envelope.ciphertext !== "string"
  )
    throw new Error("The encrypted history is invalid.");
  try {
    const plaintext = await crypto.subtle.decrypt(
      {
        name: "AES-GCM",
        iv: unb64(envelope.iv),
        additionalData: new TextEncoder().encode(source),
      },
      await keyFor(code),
      unb64(envelope.ciphertext),
    );
    return validateSnapshot(
      JSON.parse(new TextDecoder().decode(plaintext)),
      source,
    );
  } catch {
    throw new Error(
      "History could not be unlocked. Check that all connected apps use the same connection code.",
    );
  }
}
export async function getHistory(
  code,
  source,
  { endpoint = SYNC_ENDPOINT, fetcher = fetch } = {},
) {
  const response = await fetcher(`${endpoint}/api/history/${source}`, {
    headers: { Authorization: `Bearer ${await authFor(code)}` },
    cache: "no-store",
    signal: AbortSignal.timeout(15000),
  });
  if (response.status === 404) return null;
  if (!response.ok)
    throw new Error(
      "Sync is unavailable. Your last synced history is still on this device.",
    );
  const body = await response.json();
  return {
    snapshot: await decryptSnapshot(code, body, source),
    updatedAt: response.headers.get("X-Synced-At"),
    etag: response.headers.get("ETag"),
  };
}
export async function putHistory(
  code,
  snapshot,
  { endpoint = SYNC_ENDPOINT, fetcher = fetch } = {},
) {
  const headers = {
    Authorization: `Bearer ${await authFor(code)}`,
    "Content-Type": "application/json",
  };
  const response = await fetcher(`${endpoint}/api/history/${snapshot.source}`, {
    method: "PUT",
    headers,
    body: JSON.stringify(await encryptSnapshot(code, snapshot)),
    signal: AbortSignal.timeout(15000),
  });
  if (!response.ok)
    throw new Error(
      response.status === 413
        ? "History is too large to sync."
        : "Could not sync yet. It will retry automatically when this tracker is open.",
    );
  return response.json();
}
