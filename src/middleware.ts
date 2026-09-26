import { NextRequest, NextResponse } from "next/server";
import { AUTH_COOKIE, authTokenForPassword, getSitePassword, safeEqual } from "@/lib/auth";

/**
 * Password gate — every page and API route requires the session cookie,
 * except the login page, the login endpoint and static assets.
 */
export async function middleware(req: NextRequest) {
  const token = req.cookies.get(AUTH_COOKIE)?.value;
  const expected = await authTokenForPassword(getSitePassword());

  if (token && safeEqual(token, expected)) {
    // Already authenticated — but don't loop on /login itself.
    if (req.nextUrl.pathname === "/login") {
      return NextResponse.redirect(new URL("/", req.url));
    }
    return NextResponse.next();
  }

  if (req.nextUrl.pathname === "/login" || req.nextUrl.pathname === "/api/auth/login") {
    return NextResponse.next();
  }

  if (req.nextUrl.pathname.startsWith("/api/")) {
    return NextResponse.json({ ok: false, message: "Not authorized — log in first." }, { status: 401 });
  }

  const loginUrl = new URL("/login", req.url);
  loginUrl.searchParams.set("next", req.nextUrl.pathname);
  return NextResponse.redirect(loginUrl);
}

export const config = {
  matcher: [
    /*
     * Protect everything except:
     *  - _next/static, _next/image (build assets)
     *  - favicon / logo / robots
     *  - /login and /api/auth/login (handled above)
     *  - /api/health (public keep-alive ping target — no secrets exposed)
     */
    "/((?!_next/static|_next/image|favicon\\.ico|logo\\.svg|robots\\.txt|login|api/auth/login|api/health).*)",
  ],
};
