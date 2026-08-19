/**
 * Shared-secret gate. One password, held in the APP_SECRET binding, exchanged for
 * an HMAC-signed cookie so the secret itself is never stored in the browser.
 */

const COOKIE = "vertica_session";
const MAX_AGE_SECONDS = 60 * 60 * 24 * 30;

function bytes(value: string) {
  return new TextEncoder().encode(value);
}

function toHex(buffer: ArrayBuffer) {
  return [...new Uint8Array(buffer)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

async function sign(value: string, secret: string) {
  const key = await crypto.subtle.importKey("raw", bytes(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return toHex(await crypto.subtle.sign("HMAC", key, bytes(value)));
}

/** Length-independent comparison, so a wrong password leaks nothing through timing. */
function equals(a: string, b: string) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

function readCookie(request: Request, name: string) {
  const header = request.headers.get("cookie") ?? "";
  for (const part of header.split(";")) {
    const [key, ...rest] = part.trim().split("=");
    if (key === name) return rest.join("=");
  }
  return null;
}

export async function isAuthorised(request: Request, secret: string | undefined) {
  // With no secret configured the gate is open, which is what local development wants.
  if (!secret) return true;

  const cookie = readCookie(request, COOKIE);
  if (!cookie) return false;

  const [issuedAt, signature] = cookie.split(".");
  if (!issuedAt || !signature) return false;
  if (Number(issuedAt) + MAX_AGE_SECONDS * 1000 < Date.now()) return false;

  return equals(signature, await sign(issuedAt, secret));
}

export async function createSessionCookie(secret: string) {
  const issuedAt = String(Date.now());
  const signature = await sign(issuedAt, secret);
  return `${COOKIE}=${issuedAt}.${signature}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${MAX_AGE_SECONDS}`;
}

export function clearSessionCookie() {
  return `${COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`;
}

export function passwordMatches(submitted: unknown, secret: string) {
  return typeof submitted === "string" && equals(submitted, secret);
}
