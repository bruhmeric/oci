/**
 * OCI (Oracle Cloud Infrastructure) error classification.
 * Maps raw HTTP / SDK errors onto hunting-relevant kinds so the
 * retry engine knows what is worth retrying and what is fatal.
 */

export type OciErrorKind =
  | "capacity" // Out of host capacity — the classic free-tier retry case
  | "rate-limit" // 429 — too many requests
  | "server-error" // 5xx transient
  | "limit-exceeded" // tenancy service limit (e.g. standard-a1-memory-count)
  | "auth" // 401/403 — bad key / fingerprint / OCID
  | "not-found" // 404 — bad image / subnet / compartment OCID
  | "conflict" // 409
  | "bad-request" // 400 — malformed payload
  | "network" // local machine could not reach OCI
  | "unknown";

export const RETRYABLE_KINDS: Set<OciErrorKind> = new Set([
  "capacity",
  "rate-limit",
  "server-error",
  "network",
]);

export interface OciError extends Error {
  status?: number;
  code?: string;
  opcRequestId?: string | null;
  kind?: OciErrorKind;
  retryable?: boolean;
}

export function isOciError(e: unknown): e is OciError {
  return e instanceof Error && typeof (e as OciError).status !== "undefined";
}

/** Human-friendly message for an OCI failure. */
export function describeOciError(e: unknown): string {
  if (isOciError(e)) {
    const code = e.code ? ` [${e.code}]` : "";
    const rid = e.opcRequestId ? ` (opc-request-id: ${e.opcRequestId})` : "";
    return `${e.message}${code}${rid}`;
  }
  if (e instanceof Error) return e.message;
  return String(e);
}

export function classifyOciError(e: unknown): OciErrorKind {
  if (isOciError(e)) {
    const msg = (e.message || "").toLowerCase();
    const code = e.code;
    const status = e.status;

    if (msg.includes("out of host capacity") || msg.includes("out of capacity")) return "capacity";
    // LimitExceeded must be checked BEFORE generic 429 — OCI returns it with 429/400 status.
    if (code === "LimitExceeded" || msg.includes("service limits were exceeded") || msg.includes("limit exceeded"))
      return "limit-exceeded";
    if (status === 429 || code === "TooManyRequests" || msg.includes("too many requests")) return "rate-limit";
    if (
      status === 401 ||
      code === "NotAuthenticated" ||
      code === "InvalidAuthenticationInfo" ||
      msg.includes("invalidsignature") ||
      msg.includes("notauthenticated")
    )
      return "auth";
    if (status === 403 || code === "NotAuthorizedOrNotFound") return "auth";
    if (status === 404) return "not-found";
    if (status === 409) return "conflict";
    if (status !== undefined && status >= 500) return "server-error";
    if (status === 400) return "bad-request";
    return "unknown";
  }
  if (e instanceof Error) {
    const msg = e.message.toLowerCase();
    if (
      msg.includes("enotfound") ||
      msg.includes("econnrefused") ||
      msg.includes("etimedout") ||
      msg.includes("econnreset") ||
      msg.includes("socket hang up") ||
      msg.includes("timeout") ||
      msg.includes("network") ||
      msg.includes("fetch failed")
    )
      return "network";
  }
  return "unknown";
}

/** Friendly hint shown in the UI for fatal errors. */
export function hintForKind(kind: OciErrorKind, region?: string): string {
  switch (kind) {
    case "auth":
      return [
        "Most likely causes, in order:",
        `1. Wrong home region — the region selector must show the region your tenancy is HOMED in (check the top-right region selector in the OCI Console). Singapore has TWO regions: ap-singapore-1 and ap-singapore-2 (Singapore West) — pick the one shown as “home region” on your Tenancy details page${region ? ` (you are currently calling ${region})` : ""}.`,
        "2. The key was added in the last few minutes — new API keys can take a moment to become active; wait 1-2 minutes and retry.",
        "3. The User OCID is for a different user than the one that owns the API key (e.g. a federated vs. IAM user) — re-check Profile → User Settings → API Keys.",
      ].join("\n");
    case "not-found":
      return "One of the OCIDs (compartment / image / subnet) does not exist in this tenancy or region. Verify the region matches where your resources live.";
    case "limit-exceeded":
      return "The tenancy hit an A1 (Ampere) service limit — e.g. the 4 OCPU / 24 GB Always Free allowance is already used by other instances.";
    case "bad-request":
      return "The launch request was rejected. Common causes: boot volume smaller than the image minimum, or a subnet that is not in the chosen availability domain's region.";
    default:
      return "";
  }
}
