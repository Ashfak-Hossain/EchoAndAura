import { healthService } from '@/server/container';

export const dynamic = 'force-dynamic';

const NO_STORE = { 'Cache-Control': 'no-store' };

/**
 * ADR-036. `?live` — the process answers (Docker's container check: it must
 * not depend on Postgres or Redis, or the proxy would drop a web container
 * that could still serve pages). Plain — can the site take an order (the
 * uptime monitor): 200 or 503, booleans only.
 */
export async function GET(request: Request) {
  if (new URL(request.url).searchParams.has('live')) {
    return Response.json({ ok: true }, { headers: NO_STORE });
  }
  const report = await healthService.check();
  return Response.json(report, { status: report.ok ? 200 : 503, headers: NO_STORE });
}
