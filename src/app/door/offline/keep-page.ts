import {
  FILES_CACHE,
  PAGE_CACHE,
  PAGE_PATH,
  WORKER_SCOPE,
  WORKER_URL,
  filesToKeep,
} from './saved-page';

/**
 * ADR-035: the page's side of the saved copy. A page is not controlled by
 * the worker on its first load, so the page saves itself: once the
 * scanner is signed in and has reached the server, it saves a fresh copy
 * of /door and every build file this load used — and drops files an
 * older build used. When the session ends the copy is deleted: it shows
 * the gate's last scans, with names.
 *
 * Production only: in `next dev` file names change on every edit, and a
 * worker there would serve yesterday's code.
 */

/** Bumped by forget(): a save still in flight must not bring the copy back. */
let generation = 0;

function supported(): boolean {
  return (
    process.env.NODE_ENV === 'production' &&
    typeof window !== 'undefined' &&
    window.isSecureContext &&
    'serviceWorker' in navigator &&
    'caches' in window
  );
}

/** Register the worker and save this page for a reload without signal. Never throws. */
export async function keepPageOffline(): Promise<void> {
  if (!supported()) return;
  const gen = generation;
  try {
    await navigator.serviceWorker.register(WORKER_URL, { scope: WORKER_SCOPE });
    const files = filesToKeep(
      performance.getEntriesByType('resource').map((e) => e.name),
      window.location.origin,
    );
    // A fresh render for the saved copy: the cookie says which pass.
    const page = await fetch(PAGE_PATH, { cache: 'no-store', credentials: 'same-origin' });
    if (!page.ok || page.redirected) return;
    const [pageCache, fileCache] = await Promise.all([
      caches.open(PAGE_CACHE),
      caches.open(FILES_CACHE),
    ]);
    const had = new Set(
      (await fileCache.keys()).map((r) => {
        const url = new URL(r.url);
        return url.pathname + url.search;
      }),
    );
    // Most come from the browser's own cache: they were loaded just now.
    for (const path of files) {
      if (had.has(path)) continue;
      const res = await fetch(path);
      if (res.ok) await fileCache.put(path, res);
    }
    if (gen !== generation) return;
    await pageCache.put(PAGE_PATH, page);
    // A new build's page runs on new files: the old ones are dead weight.
    const wanted = new Set(files);
    await Promise.all(
      [...had].filter((path) => !wanted.has(path)).map((path) => fileCache.delete(path)),
    );
  } catch {
    // No copy this time: the gate works as it did, online or offline.
  }
}

/** The session is over: delete the saved page (it lists recent names). Never throws. */
export async function forgetPageOffline(): Promise<void> {
  generation += 1;
  if (typeof window === 'undefined' || !('caches' in window)) return;
  try {
    await caches.delete(PAGE_CACHE);
  } catch {
    // Storage blocked: nothing was saved either.
  }
}
