import { getSessionCookie } from 'better-auth/cookies';
import { NextResponse, type NextRequest } from 'next/server';
import {
  ACCESS_JWT_COOKIE,
  ACCESS_JWT_HEADER,
  createAccessVerifier,
  readAccessConfig,
  type AccessVerifier,
} from '@/lib/cf-access';
import { buildCsp, newNonce, originFrom } from '@/lib/csp';

const LOGIN_PATH = '/admin/login';
/** Pages for a signed-out admin: sign in and its code step (ADR-049), and the password reset (ADR-038). */
const PUBLIC_PATHS = new Set([
  LOGIN_PATH,
  // ADR-049: between password and code there is no session yet, only
  // better-auth's short-lived two-factor challenge cookie.
  '/admin/login/verify',
  '/admin/forgot-password',
  '/admin/reset-password',
]);

/**
 * Next 16's `proxy` (the successor to middleware). It runs before every
 * page render and must stay lightweight — no database access. Three jobs:
 *
 * 0. ADR-050: every /admin request — sign-in, reset and code step
 *    included — must carry a valid Cloudflare Access token once Access
 *    is configured. Refused with a bare 403 before anything renders.
 * 1. ADR-043: a fresh CSP nonce per request. Next reads the policy from
 *    the request headers and stamps the nonce on its own scripts, which
 *    only works for pages rendered per request; the few Next would
 *    prerender are made dynamic (see src/app/not-found.tsx).
 * 2. An optimistic auth redirect for the admin area: it only checks that a
 *    session cookie is *present*. The authoritative, DB-backed check lives
 *    in src/app/admin/(protected)/layout.tsx; this just saves a render
 *    round-trip for clearly-anonymous requests.
 */
export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;

  if (isAdminPath(pathname) && !(await passesAccess(request))) {
    return new NextResponse('Forbidden', { status: 403 });
  }

  // The signed-in admin pages (a signed-out one only sees sign-in and reset).
  const admin = isAdminPath(pathname) && !PUBLIC_PATHS.has(pathname);
  if (admin && !getSessionCookie(request)) {
    return NextResponse.redirect(new URL(LOGIN_PATH, request.url));
  }

  const csp = buildCsp({
    nonce: newNonce(),
    mediaOrigin: originFrom(process.env.R2_PUBLIC_URL),
    uploadOrigin: admin ? originFrom(process.env.R2_ENDPOINT) : null,
    door: pathname === '/door' || pathname.startsWith('/door/'),
    dev: process.env.NODE_ENV === 'development',
  });
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set('Content-Security-Policy', csp);
  const response = NextResponse.next({ request: { headers: requestHeaders } });
  response.headers.set('Content-Security-Policy', csp);
  return response;
}

let accessVerifier: AccessVerifier | null | undefined;

async function passesAccess(request: NextRequest): Promise<boolean> {
  if (accessVerifier === undefined) {
    const config = readAccessConfig();
    accessVerifier = config ? createAccessVerifier(config) : null;
  }
  // Not configured (dev, e2e, before the Admin app exists): nothing to check.
  if (!accessVerifier) return true;
  const token =
    request.headers.get(ACCESS_JWT_HEADER) ?? request.cookies.get(ACCESS_JWT_COOKIE)?.value;
  return accessVerifier.verify(token);
}

function isAdminPath(pathname: string): boolean {
  return pathname === '/admin' || pathname.startsWith('/admin/');
}

export const config = {
  matcher: [
    {
      // Pages only. API routes (the door's too), build assets, the image
      // optimizer, the self-hosted decoder and the door's service worker
      // carry no HTML.
      // Prefetches are skipped: the navigation that follows gets its own.
      source: '/((?!api/|door/api/|_next/static|_next/image|vendor/|door/sw\\.js|favicon\\.ico).*)',
      missing: [
        { type: 'header', key: 'next-router-prefetch' },
        { type: 'header', key: 'purpose', value: 'prefetch' },
      ],
    },
    // ADR-050: admin prefetches too. A prefetch carries the admin page's
    // render, so the Access check can't skip it.
    '/admin',
    '/admin/:path*',
  ],
};
