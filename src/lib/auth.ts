/**
 * Shared cookie-auth helpers — used by the Edge middleware and the
 * Node login route, so everything here must run in BOTH runtimes
 * (WebCrypto only, no node: imports).
 */

export const AUTH_COOKIE = "hunter_auth";
export const AUTH_SALT = "oci-free-tier-hunter-v1";

/** Neutral fallback only — always set SITE_PASSWORD in your hosting dashboard. */
const DEFAULT_PASSWORD = "change-me";

export function getSitePassword(): string {
  return process.env.SITE_PASSWORD?.trim() || DEFAULT_PASSWORD;
}

/** sha256(salt ":" password) hex — the cookie value. */
export async function authTokenForPassword(password: string): Promise<string> {
  const data = new TextEncoder().encode(`${AUTH_SALT}:${password}`);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/** Constant-time-ish string compare. */
export function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let out = 0;
  for (let i = 0; i < a.length; i++) out |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return out === 0;
}

/** True when the request carries a valid session cookie. */
export async function hasValidAuth(req: Request): Promise<boolean> {
  const cookie = req.headers.get("cookie") ?? "";
  const m = cookie.match(new RegExp(`(?:^|;\\s*)${AUTH_COOKIE}=([^;]+)`));
  if (!m) return false;
  const expected = await authTokenForPassword(getSitePassword());
  return safeEqual(decodeURIComponent(m[1]), expected);
}
