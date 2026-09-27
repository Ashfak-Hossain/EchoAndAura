import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { doorService } from '@/server/container';
import { logger } from '@/server/lib/logger';
import { safeErrorShape } from '@/server/lib/pg-errors';
import type { DoorContext } from '@/server/services/door.service';
import { siteUrl } from '@/lib/env.public';

/**
 * ADR-030: a door phone's credential is its gate-pass code, held in an
 * httpOnly cookie scoped to /door — it never travels with /admin or public
 * requests, and it is a different credential from any better-auth session,
 * so a door phone can never reach the back office. Lax (not Strict) so a
 * pass link opened from WhatsApp still carries it; every door write is a
 * same-origin JSON POST/DELETE, checked here.
 */
export const DOOR_COOKIE = 'door_pass';
export const DOOR_COOKIE_PATH = '/door';

/**
 * The pass on this request, or null (no cookie, wrong code, revoked, over).
 * A database failure is logged WITHOUT the query params — the param is the
 * pass code itself — and rethrown as a plain error for the same reason.
 */
export async function currentDoor(): Promise<DoorContext | null> {
  const code = (await cookies()).get(DOOR_COOKIE)?.value;
  if (!code) return null;
  try {
    return await doorService.authenticate(code);
  } catch (err: unknown) {
    logger.error({ err: safeErrorShape(err) }, 'door: pass lookup failed');
    throw new Error('door: pass lookup failed');
  }
}

/**
 * Secure whenever the site is HTTPS (SITE_URL, like better-auth's own
 * cookies) — not from X-Forwarded-Proto, which a proxy may not send; the
 * cookie holds the pass code itself. The request protocol only adds to it.
 */
function isHttps(request: Request): boolean {
  if (siteUrl().startsWith('https://')) return true;
  const proto = request.headers.get('x-forwarded-proto')?.split(',')[0]?.trim();
  return (proto ?? new URL(request.url).protocol.replace(':', '')) === 'https';
}

export function setDoorCookie(
  response: NextResponse,
  request: Request,
  code: string,
  validUntil: Date,
): void {
  response.cookies.set(DOOR_COOKIE, code, {
    httpOnly: true,
    sameSite: 'lax',
    secure: isHttps(request),
    path: DOOR_COOKIE_PATH,
    // Max-Age, not Expires: a phone with a wrong clock still keeps it right.
    maxAge: Math.max(0, Math.floor((validUntil.getTime() - Date.now()) / 1000)),
  });
}

export function clearDoorCookie(response: NextResponse): void {
  response.cookies.set(DOOR_COOKIE, '', { path: DOOR_COOKIE_PATH, maxAge: 0 });
}

/**
 * CSRF guard for door writes: JSON only, and the Origin must be this host
 * (route handlers get no built-in origin check, unlike Server Actions).
 */
export function isSameOriginJson(request: Request): boolean {
  const type = request.headers.get('content-type') ?? '';
  if (!type.toLowerCase().startsWith('application/json')) return false;
  const origin = request.headers.get('origin');
  const host = request.headers.get('x-forwarded-host') ?? request.headers.get('host');
  if (!origin || !host) return false;
  try {
    return new URL(origin).host === host;
  } catch {
    return false;
  }
}

/** Every door response: never cached, anywhere. */
export function doorJson(body: unknown, init: ResponseInit = {}): NextResponse {
  const response = NextResponse.json(body, init);
  response.headers.set('Cache-Control', 'no-store');
  return response;
}

export const DOOR_UNAUTHORISED = () =>
  doorJson({ error: 'This gate pass is not active. Enter the gate code again.' }, { status: 401 });
export const DOOR_FORBIDDEN = () => doorJson({ error: 'Bad request origin.' }, { status: 403 });
export const DOOR_SLOW_DOWN = (retryAfterSeconds: number) => {
  const response = doorJson(
    { error: `Slow down — wait ${retryAfterSeconds} s.`, retryAfter: retryAfterSeconds },
    { status: 429 },
  );
  response.headers.set('Retry-After', String(retryAfterSeconds));
  return response;
};
