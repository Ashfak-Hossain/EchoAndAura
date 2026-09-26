import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  type CacheLike,
  type CachesLike,
  type ExtendableEventLike,
  type FetchEventLike,
  type Wait,
  type WorkerScope,
  installDoorWorker,
} from '@/app/door/offline/door-worker';
import {
  FILES_CACHE,
  PAGE_CACHE,
  PAGE_TIMEOUT_MS,
  filesToKeep,
  routeOf,
} from '@/app/door/offline/saved-page';

const ORIGIN = 'https://gate.example';

function req(path: string, mode: RequestMode = 'no-cors', method = 'GET') {
  return { method, mode, url: new URL(path, ORIGIN).href };
}

describe('routeOf (ADR-035)', () => {
  it('answers opening /door itself', () => {
    expect(routeOf(req('/door', 'navigate'), ORIGIN)).toBe('page');
    expect(routeOf(req('/door?from=pass', 'navigate'), ORIGIN)).toBe('page');
  });

  it('answers build files and the decoder', () => {
    expect(routeOf(req('/_next/static/chunks/app.js'), ORIGIN)).toBe('file');
    expect(routeOf(req('/_next/static/media/font.woff2', 'cors'), ORIGIN)).toBe('file');
    expect(routeOf(req('/vendor/zxing_reader-3.1.3.wasm', 'cors'), ORIGIN)).toBe('file');
  });

  it('never touches the door API, the RSC refresh, writes or other origins', () => {
    expect(routeOf(req('/door/api/status', 'cors'), ORIGIN)).toBe('network');
    expect(routeOf(req('/door/api/list', 'cors'), ORIGIN)).toBe('network');
    expect(routeOf(req('/door/api/scans', 'cors', 'POST'), ORIGIN)).toBe('network');
    // router.refresh() after sign-in: a fetch of /door, not a navigation.
    expect(routeOf(req('/door?_rsc=abc', 'cors'), ORIGIN)).toBe('network');
    expect(routeOf(req('/door/sw.js', 'same-origin'), ORIGIN)).toBe('network');
    expect(routeOf(req('/admin', 'navigate'), ORIGIN)).toBe('network');
    expect(
      routeOf({ method: 'GET', mode: 'cors', url: 'https://cdn.example/_next/static/a.js' }, ORIGIN),
    ).toBe('network');
  });
});

describe('filesToKeep (ADR-035)', () => {
  it('keeps same-origin build files as path + query, once each', () => {
    expect(
      filesToKeep(
        [
          `${ORIGIN}/_next/static/chunks/a.js`,
          `${ORIGIN}/_next/static/chunks/a.js`,
          `${ORIGIN}/_next/static/css/b.css?dpl=1`,
          `${ORIGIN}/vendor/zxing_reader-3.1.3.wasm`,
          `${ORIGIN}/door/api/status`,
          'https://cdn.example/_next/static/c.js',
          'not a url at all ::',
        ],
        ORIGIN,
      ),
    ).toEqual([
      '/_next/static/chunks/a.js',
      '/_next/static/css/b.css?dpl=1',
      '/vendor/zxing_reader-3.1.3.wasm',
    ]);
  });
});

/** Caches keyed by path + query, like the real ones for same-origin GETs. */
class FakeCaches implements CachesLike {
  stores = new Map<string, Map<string, Response>>();
  async open(name: string): Promise<CacheLike> {
    const store = this.stores.get(name) ?? new Map<string, Response>();
    this.stores.set(name, store);
    const key = (k: RequestInfo) => {
      const url = new URL(typeof k === 'string' ? k : k.url, ORIGIN);
      return url.pathname + url.search;
    };
    return {
      match: async (k, options) => {
        const hit =
          store.get(key(k)) ??
          (options?.ignoreSearch ? store.get(new URL(key(k), ORIGIN).pathname) : undefined);
        return hit?.clone();
      },
      put: async (k, res) => {
        store.set(key(k), res);
      },
    };
  }
  async keys() {
    return [...this.stores.keys()];
  }
  async delete(name: string) {
    return this.stores.delete(name);
  }
}

function page(body: string, status = 200) {
  return new Response(body, { status, headers: { 'Content-Type': 'text/html' } });
}

function setup(options: { onLine?: boolean; wait?: Wait } = {}) {
  const caches = new FakeCaches();
  const fetch = vi.fn<(r: Request) => Promise<Response>>();
  const listeners = new Map<string, (event: never) => void>();
  const scope: WorkerScope = {
    location: { origin: ORIGIN },
    navigator: { onLine: options.onLine ?? true },
    caches,
    fetch,
    skipWaiting: vi.fn(async () => undefined),
    clients: { claim: vi.fn(async () => undefined) },
    addEventListener: (type, listener) => {
      listeners.set(type, listener as (event: never) => void);
    },
  };
  installDoorWorker(scope, options.wait ?? (() => new Promise<null>(() => undefined)));

  /** Dispatch a fetch; the answer, or null when left to the network. */
  async function request(path: string, mode: RequestMode = 'no-cors') {
    const request = new Request(new URL(path, ORIGIN), {
      mode: mode === 'navigate' ? 'same-origin' : mode,
    });
    // Request() will not construct a navigation; the worker only reads these.
    const view = new Proxy(request, {
      get: (target, prop) =>
        prop === 'mode' ? mode : Reflect.get(target, prop, target) as unknown,
    });
    let answer: Promise<Response> | null = null;
    const event: FetchEventLike = {
      request: view,
      respondWith: (r) => {
        answer = r;
      },
      waitUntil: () => undefined,
    };
    (listeners.get('fetch') as (e: FetchEventLike) => void)(event);
    return answer ? await (answer as Promise<Response>) : null;
  }

  async function lifecycle(type: 'install' | 'activate') {
    const waits: Promise<unknown>[] = [];
    const event: ExtendableEventLike = { waitUntil: (p) => void waits.push(p) };
    (listeners.get(type) as (e: ExtendableEventLike) => void)(event);
    await Promise.all(waits);
  }

  async function savePage(body: string) {
    await (await caches.open(PAGE_CACHE)).put('/door', page(body));
  }

  return { caches, fetch, scope, request, lifecycle, savePage };
}

describe('the door worker: opening /door (ADR-035)', () => {
  it('gives the fresh page when the server answers in time, and saves nothing itself', async () => {
    const w = setup();
    await w.savePage('old copy');
    w.fetch.mockResolvedValue(page('fresh'));
    const res = await w.request('/door', 'navigate');
    expect(await res?.text()).toBe('fresh');
    const kept = await (await w.caches.open(PAGE_CACHE)).match('/door');
    expect(await kept?.text()).toBe('old copy');
  });

  it('opens the saved copy when the network fails', async () => {
    const w = setup();
    await w.savePage('saved scanner');
    w.fetch.mockRejectedValue(new TypeError('Failed to fetch'));
    const res = await w.request('/door?x=1', 'navigate');
    expect(await res?.text()).toBe('saved scanner');
  });

  it('opens the saved copy at once when the phone has no network, without trying', async () => {
    const w = setup({ onLine: false });
    await w.savePage('saved scanner');
    const res = await w.request('/door', 'navigate');
    expect(await res?.text()).toBe('saved scanner');
    expect(w.fetch).not.toHaveBeenCalled();
  });

  it('opens the saved copy when the server is too slow', async () => {
    const waits: number[] = [];
    const w = setup({
      wait: (ms) => {
        waits.push(ms);
        return Promise.resolve(null);
      },
    });
    await w.savePage('saved scanner');
    w.fetch.mockReturnValue(new Promise<Response>(() => undefined));
    const res = await w.request('/door', 'navigate');
    expect(await res?.text()).toBe('saved scanner');
    expect(waits).toEqual([PAGE_TIMEOUT_MS]);
  });

  it('prefers the saved copy to a server error, and passes the error on without one', async () => {
    const w = setup();
    w.fetch.mockImplementation(async () => page('bad gateway', 502));
    expect((await w.request('/door', 'navigate'))?.status).toBe(502);
    await w.savePage('saved scanner');
    expect(await (await w.request('/door', 'navigate'))?.text()).toBe('saved scanner');
  });

  it('waits on for a slow server when there is no saved copy', async () => {
    const w = setup({ wait: () => Promise.resolve(null) });
    let answer: (r: Response) => void = () => undefined;
    w.fetch.mockReturnValue(new Promise<Response>((resolve) => (answer = resolve)));
    const pending = w.request('/door', 'navigate');
    await Promise.resolve();
    answer(page('late but fresh'));
    expect(await (await pending)?.text()).toBe('late but fresh');
  });

  it('shows the no-signal page when there is neither network nor a saved copy', async () => {
    const w = setup();
    w.fetch.mockRejectedValue(new TypeError('Failed to fetch'));
    const res = await w.request('/door', 'navigate');
    expect(res?.status).toBe(503);
    expect(res?.headers.get('Cache-Control')).toBe('no-store');
    const html = (await res?.text()) ?? '';
    expect(html).toContain('No signal');
    expect(html).toContain('printed list');
  });

  it('leaves the door API and other pages to the network', async () => {
    const w = setup();
    expect(await w.request('/door/api/status', 'cors')).toBeNull();
    expect(await w.request('/door?_rsc=1', 'cors')).toBeNull();
    expect(await w.request('/admin', 'navigate')).toBeNull();
    expect(w.fetch).not.toHaveBeenCalled();
  });
});

describe('the door worker: build files (ADR-035)', () => {
  let w: ReturnType<typeof setup>;
  beforeEach(() => {
    w = setup();
  });

  it('serves a saved file without the network', async () => {
    await (await w.caches.open(FILES_CACHE)).put('/_next/static/a.js', new Response('saved js'));
    const res = await w.request('/_next/static/a.js');
    expect(await res?.text()).toBe('saved js');
    expect(w.fetch).not.toHaveBeenCalled();
  });

  it('saves a file it had to fetch (the decoder loaded on Start)', async () => {
    w.fetch.mockResolvedValue(new Response('wasm bytes'));
    const res = await w.request('/vendor/zxing_reader-3.1.3.wasm', 'cors');
    expect(await res?.text()).toBe('wasm bytes');
    const kept = await (await w.caches.open(FILES_CACHE)).match('/vendor/zxing_reader-3.1.3.wasm');
    expect(await kept?.text()).toBe('wasm bytes');
  });

  it('never saves a failed fetch', async () => {
    w.fetch.mockResolvedValue(new Response('missing', { status: 404 }));
    expect((await w.request('/_next/static/gone.js'))?.status).toBe(404);
    expect(await (await w.caches.open(FILES_CACHE)).match('/_next/static/gone.js')).toBeUndefined();
  });
});

describe('the door worker: install and activate (ADR-035)', () => {
  it('takes over at once, and drops only its own older caches', async () => {
    const w = setup();
    await w.caches.open('door-page-v0');
    await w.caches.open(PAGE_CACHE);
    await w.caches.open(FILES_CACHE);
    await w.caches.open('someone-else');
    await w.lifecycle('install');
    expect(w.scope.skipWaiting).toHaveBeenCalled();
    await w.lifecycle('activate');
    expect((await w.caches.keys()).sort()).toEqual([FILES_CACHE, PAGE_CACHE, 'someone-else'].sort());
    expect(w.scope.clients.claim).toHaveBeenCalled();
  });
});
