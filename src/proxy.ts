import { getSessionCookie } from 'better-auth/cookies';
import { NextResponse, type NextRequest } from 'next/server';
import {
  ACCESS_JWT_COOKIE,
  ACCESS_JWT_HEADER,
  createAccessVerifier,
  readAccessConfig,
  type AccessVerifier,
} from '@/lib/cf-access';
import { buildCsp, newNonce, originFrom, wsOriginFrom } from '@/lib/csp';
import {
  LOCALE_COOKIE,
  LOCALE_HEADER,
  type LocaleStep,
  localeStep,
  publicLocales,
} from '@/i18n/locales';

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
 * 3. ADR-061: the language. `/bn/…` is rewritten to the English route with
 *    the locale in a request header; a visitor who chose Bangla is sent to
 *    the `/bn` form of an English link. Before the CSP step, so the policy
 *    lands on whichever response this produces.
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

  const step = localeStep({
    pathname,
    search: request.nextUrl.search,
    method: request.method,
    cookie: request.cookies.get(LOCALE_COOKIE)?.value,
    locales: publicLocales(process.env.PUBLIC_LOCALES),
  });
  if (step.kind === 'redirect') {
    return NextResponse.redirect(new URL(step.to, request.url), 307);
  }

  const requestHeaders = new Headers(request.headers);
  // Always set, never passed through: a visitor's own header must not make
  // an English URL render (and be cached) in Bangla.
  requestHeaders.set(LOCALE_HEADER, step.locale);

  // A public prefetch gets only the language step — before ADR-061 it got
  // nothing: a nonce on a prefetched render broke the navigation after it
  // (measured: the e2e suite failed). The navigation gets its own.
  if (isPrefetch(request) && !isAdminPath(pathname)) {
    return forward(request, step, requestHeaders);
  }

  const csp = buildCsp({
    nonce: newNonce(),
    mediaOrigin: originFrom(process.env.R2_PUBLIC_URL),
    uploadOrigin: admin ? originFrom(process.env.R2_ENDPOINT) : null,
    door: pathname === '/door' || pathname.startsWith('/door/'),
    relayOrigin: wsOriginFrom(process.env.RELAY_URL),
    dev: process.env.NODE_ENV === 'development',
  });
  requestHeaders.set('Content-Security-Policy', csp);
  const response = forward(request, step, requestHeaders);
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

/** On to the page — under its English route for `/bn/…` (ADR-061). */
function forward(request: NextRequest, step: LocaleStep, headers: Headers): NextResponse {
  const init = { request: { headers } };
  return step.kind === 'rewrite'
    ? NextResponse.rewrite(new URL(`${step.path}${request.nextUrl.search}`, request.url), init)
    : NextResponse.next(init);
}

function isPrefetch(request: NextRequest): boolean {
  return (
    request.headers.has('next-router-prefetch') || request.headers.get('purpose') === 'prefetch'
  );
}

function isAdminPath(pathname: string): boolean {
  return pathname === '/admin' || pathname.startsWith('/admin/');
}

export const config = {
  matcher: [
    // Pages only. API routes (the door's too), build assets, the image
    // optimizer, the self-hosted decoder and the door's service worker
    // carry no HTML. Prefetches included: a prefetch carries a page's
    // render, so the Access check (ADR-050) and the language step
    // (ADR-061: `/bn` rewritten, a visitor's own locale header replaced)
    // can't skip it.
    '/((?!api/|door/api/|_next/static|_next/image|vendor/|door/sw\\.js|favicon\\.ico).*)',
  ],
};
