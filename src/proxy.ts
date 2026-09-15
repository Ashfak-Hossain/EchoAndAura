import { getSessionCookie } from 'better-auth/cookies';
import { NextResponse, type NextRequest } from 'next/server';

const LOGIN_PATH = '/admin/login';

/**
 * Optimistic auth redirect for the admin area. This is Next 16's `proxy`
 * (the successor to middleware): it runs before rendering, must stay lightweight,
 * and only checks that a session cookie is *present* — no database access.
 *
 * The authoritative, DB-backed session check lives in
 * src/app/admin/(protected)/layout.tsx; this just saves a render round-trip
 * for clearly-anonymous requests.
 */
export function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;

  if (pathname === LOGIN_PATH) {
    return NextResponse.next();
  }
  if (!getSessionCookie(request)) {
    return NextResponse.redirect(new URL(LOGIN_PATH, request.url));
  }
  return NextResponse.next();
}

export const config = {
  matcher: ['/admin/:path*'],
};
