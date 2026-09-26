import { NextRequest } from "next/server";
import { AUTH_COOKIE, authTokenForPassword, getSitePassword, safeEqual } from "@/lib/auth";

export const runtime = "nodejs";

/* ------------------ tiny in-memory brute-force lockout ------------------ */
const attempts = new Map<string, { count: number; blockedUntil: number }>();
const MAX_ATTEMPTS = 5;
const BLOCK_MS = 10 * 60 * 1000;

function clientKey(req: NextRequest): string {
  return (
    req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    req.headers.get("x-real-ip") ||
    "local"
  );
}

export async function POST(req: NextRequest) {
  const key = clientKey(req);
  const now = Date.now();
  const rec = attempts.get(key);

  if (rec && rec.blockedUntil > now) {
    const mins = Math.ceil((rec.blockedUntil - now) / 60000);
    return Response.json(
      { ok: false, message: `Too many failed attempts — locked for ${mins} more minute${mins > 1 ? "s" : ""}.` },
      { status: 429 }
    );
  }

  let password = "";
  try {
    const body = await req.json();
    password = String(body?.password ?? "");
  } catch {
    return Response.json({ ok: false, message: "Invalid request body." }, { status: 400 });
  }

  if (!safeEqual(password, getSitePassword())) {
    const next = { count: (rec?.count ?? 0) + 1, blockedUntil: 0 };
    if (next.count >= MAX_ATTEMPTS) {
      next.blockedUntil = Date.now() + BLOCK_MS;
      next.count = 0;
    }
    attempts.set(key, next);
    const left = MAX_ATTEMPTS - (rec?.count ?? 0) - 1;
    return Response.json(
      {
        ok: false,
        message: left > 0 ? `Wrong password — ${left} attempt${left > 1 ? "s" : ""} left before a 10-minute lock.` : "Wrong password — locked for 10 minutes.",
      },
      { status: 401 }
    );
  }

  attempts.delete(key);

  const token = await authTokenForPassword(getSitePassword());
  const isHttps = (req.headers.get("x-forwarded-proto") ?? "").split(",")[0].trim() === "https";
  const res = Response.json({ ok: true });
  res.headers.append(
    "set-cookie",
    `${AUTH_COOKIE}=${encodeURIComponent(token)}; Path=/; Max-Age=${30 * 24 * 3600}; HttpOnly; SameSite=Lax${isHttps ? "; Secure" : ""}`
  );
  return res;
}
