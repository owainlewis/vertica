/**
 * Shared-secret gate. One password, read from APP_SECRET, exchanged for
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

/**
  * Constant time over equal-length inputs. It still returns early on a length
  * mismatch, so only feed it values whose length is fixed and public: the hex
  * digests below qualify, a submitted password does not.
  */
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

/** Omitted over plain HTTP, or the cookie would never be set in local development. */
function attributes(secure: boolean) {
  return `Path=/; HttpOnly; SameSite=Lax${secure ? "; Secure" : ""}`;
}

export function isSecureRequest(request: Request) {
  return new URL(request.url).protocol === "https:";
}

export async function createSessionCookie(secret: string, secure: boolean) {
  const issuedAt = String(Date.now());
  const signature = await sign(issuedAt, secret);
  return `${COOKIE}=${issuedAt}.${signature}; ${attributes(secure)}; Max-Age=${MAX_AGE_SECONDS}`;
}

export function clearSessionCookie(secure: boolean) {
  return `${COOKIE}=; ${attributes(secure)}; Max-Age=0`;
}

/**
 * Both sides are reduced to a fixed-length digest before they are compared, so the
 * comparison cannot return early and the length of the real password is not
 * observable through timing.
 */
export async function passwordMatches(submitted: unknown, secret: string) {
  if (typeof submitted !== "string") return false;
  const [a, b] = await Promise.all([sign(submitted, secret), sign(secret, secret)]);
  return equals(a, b);
}
