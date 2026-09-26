/**
 * ADR-035: the /door page loads with no signal. A service worker keeps a
 * saved copy of the page and the files it runs on; the ticket list and the
 * outbox are already on the phone (ADR-034). What the worker and the page
 * share: the cache names and which requests the worker may answer.
 *
 * Only the page (/door) and its build files are ever saved — never the
 * door API: every answer about a ticket comes live from the server, or
 * from the offline list, never from a stale HTTP response.
 */

export const WORKER_URL = '/door/sw.js';
/** The worker's reach: the /door page. Beyond /door/, so the script sends Service-Worker-Allowed. */
export const WORKER_SCOPE = '/door';
export const PAGE_PATH = '/door';

/** Bump the version to drop every copy an older worker saved. */
export const PAGE_CACHE = 'door-page-v1';
export const FILES_CACHE = 'door-files-v1';
export const CACHE_PREFIX = 'door-';

/** Past this, a page load with (some) signal gives up and opens the saved copy. */
export const PAGE_TIMEOUT_MS = 5_000;

export type Route = 'page' | 'file' | 'network';

/**
 * What the worker does with a request. `file`: build output whose name
 * changes with its content (/_next/static) and the versioned decoder
 * (/vendor), so a saved copy is never stale. `page`: opening /door itself.
 * Everything else — the API, the RSC refresh of /door, other origins —
 * goes to the network untouched.
 */
export function routeOf(
  request: { method: string; mode: string; url: string },
  origin: string,
): Route {
  if (request.method !== 'GET') return 'network';
  const url = new URL(request.url);
  if (url.origin !== origin) return 'network';
  if (request.mode === 'navigate') return url.pathname === PAGE_PATH ? 'page' : 'network';
  if (url.pathname.startsWith('/_next/static/') || url.pathname.startsWith('/vendor/')) {
    return 'file';
  }
  return 'network';
}

/** The files a loaded page used, as cache keys (path + query): the ones worth saving. */
export function filesToKeep(urls: readonly string[], origin: string): string[] {
  const keep = new Set<string>();
  for (const raw of urls) {
    let url: URL;
    try {
      url = new URL(raw, origin);
    } catch {
      continue;
    }
    if (routeOf({ method: 'GET', mode: 'no-cors', url: url.href }, origin) === 'file') {
      keep.add(url.pathname + url.search);
    }
  }
  return [...keep];
}

/**
 * No signal and no saved copy (never opened here, or the session ended):
 * a plain page that needs nothing else from the server.
 */
export const NO_SIGNAL_HTML = `<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="robots" content="noindex">
<title>Gate — no signal</title>
<style>
body{margin:0;min-height:100dvh;display:flex;align-items:center;justify-content:center;background:#161412;color:#fff;font:17px/1.5 -apple-system,Helvetica,Arial,sans-serif}
main{max-width:26rem;padding:1.5rem}
h1{font-size:1.75rem;margin:0 0 .75rem}
p{color:rgba(255,255,255,.75);margin:0 0 1rem}
a{display:block;text-align:center;padding:1rem;border-radius:.75rem;background:#eda43c;color:#1c1a17;font-weight:700;text-decoration:none}
</style></head>
<body><main data-testid="door-no-signal">
<h1>No signal</h1>
<p>This phone has no saved copy of the gate page. Check people in on the printed list for now.</p>
<p>When the signal is back, reload this page and open the gate pass again if it asks.</p>
<a href="/door">Reload</a>
</main></body></html>`;
