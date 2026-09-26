import {
  CACHE_PREFIX,
  FILES_CACHE,
  NO_SIGNAL_HTML,
  PAGE_CACHE,
  PAGE_PATH,
  PAGE_TIMEOUT_MS,
  routeOf,
} from './saved-page';

/**
 * ADR-035: the /door service worker. Bundled on its own (sw.ts →
 * public/door/sw.js); written against the few worker APIs it uses, so the
 * unit tests can drive it without a browser.
 *
 * It only READS the saved page: the page itself saves its copy while it
 * is signed in and online (keep-page.ts), and deletes it when the session
 * ends. So the worker never saves a signed-out page, and never saves a
 * page it could not tell apart from one.
 */

export interface CacheLike {
  match(key: RequestInfo, options?: CacheQueryOptions): Promise<Response | undefined>;
  put(key: RequestInfo, response: Response): Promise<void>;
}

export interface CachesLike {
  open(name: string): Promise<CacheLike>;
  keys(): Promise<string[]>;
  delete(name: string): Promise<boolean>;
}

export interface ExtendableEventLike {
  waitUntil(promise: Promise<unknown>): void;
}

export interface FetchEventLike extends ExtendableEventLike {
  request: Request;
  respondWith(response: Promise<Response>): void;
}

interface Listeners {
  install: (event: ExtendableEventLike) => void;
  activate: (event: ExtendableEventLike) => void;
  fetch: (event: FetchEventLike) => void;
}

export interface WorkerScope {
  location: { origin: string };
  navigator: { onLine: boolean };
  caches: CachesLike;
  fetch(request: Request): Promise<Response>;
  skipWaiting(): Promise<void>;
  clients: { claim(): Promise<void> };
  addEventListener<K extends keyof Listeners>(type: K, listener: Listeners[K]): void;
}

/** Resolves null after `ms`: the network had its chance. */
export type Wait = (ms: number) => Promise<null>;

const wait: Wait = (ms) => new Promise((resolve) => setTimeout(() => resolve(null), ms));

function noSignal(): Response {
  return new Response(NO_SIGNAL_HTML, {
    status: 503,
    headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' },
  });
}

export function installDoorWorker(scope: WorkerScope, waitFor: Wait = wait): void {
  const saved = async (): Promise<Response | undefined> => {
    const cache = await scope.caches.open(PAGE_CACHE);
    // The key is the bare path; the navigation carried other headers.
    return cache.match(PAGE_PATH, { ignoreSearch: true, ignoreVary: true });
  };

  /**
   * Network first — a fresh page has fresh counts and the right pass — but
   * the gate cannot stand in a doorway waiting: past PAGE_TIMEOUT_MS, or
   * with no network at all, the saved copy. A server error is no page
   * either (a proxy's 502 mid-deploy): the copy is more use at a gate.
   */
  async function page(request: Request): Promise<Response> {
    if (!scope.navigator.onLine) return (await saved()) ?? noSignal();
    const network = scope.fetch(request);
    // Keep a late answer from surfacing as an unhandled rejection.
    network.catch(() => undefined);
    let first: Response | null = null;
    try {
      first = await Promise.race([network, waitFor(PAGE_TIMEOUT_MS)]);
    } catch {
      return (await saved()) ?? noSignal();
    }
    if (first && first.status < 500) return first;
    const copy = await saved();
    if (copy) return copy;
    if (first) return first;
    // Slow and nothing saved: all there is to wait for is the network.
    try {
      return await network;
    } catch {
      return noSignal();
    }
  }

  /** Content-named: a saved copy is the right one for as long as it is kept. */
  async function file(request: Request): Promise<Response> {
    const cache = await scope.caches.open(FILES_CACHE);
    const hit = await cache.match(request);
    if (hit) return hit;
    const res = await scope.fetch(request);
    // Loaded later (a chunk the page asks for on Start): saved as it
    // comes. Same-origin only (routeOf), so never an opaque answer.
    if (res.ok) await cache.put(request, res.clone());
    return res;
  }

  scope.addEventListener('install', (event) => {
    // A fixed worker should take over at once, not after every tab closes.
    event.waitUntil(scope.skipWaiting());
  });

  scope.addEventListener('activate', (event) => {
    event.waitUntil(
      (async () => {
        const current = new Set([PAGE_CACHE, FILES_CACHE]);
        const names = await scope.caches.keys();
        await Promise.all(
          names
            .filter((name) => name.startsWith(CACHE_PREFIX) && !current.has(name))
            .map((name) => scope.caches.delete(name)),
        );
        // The page that registered us is controlled from now on, not from
        // its next load: files it loads later are saved as they come.
        await scope.clients.claim();
      })(),
    );
  });

  scope.addEventListener('fetch', (event) => {
    const route = routeOf(event.request, scope.location.origin);
    if (route === 'page') event.respondWith(page(event.request));
    else if (route === 'file') event.respondWith(file(event.request));
    // 'network': not answered here — the browser fetches it as usual.
  });
}
