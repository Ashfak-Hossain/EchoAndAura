/**
 * ADR-061: the public site's languages. English lives at `/`, Bangla at
 * `/bn`; the proxy rewrites `/bn/…` to the English route and tells the
 * page its locale in a request header. Admin, the gate and the API are
 * English only and never get a `/bn` form. Pure: the proxy (edge), pages
 * and client components all use it.
 */

export const LOCALES = ['en', 'bn'] as const;
export type Locale = (typeof LOCALES)[number];
export const DEFAULT_LOCALE: Locale = 'en';

/** Request header the proxy sets on a rewritten `/bn` request. */
export const LOCALE_HEADER = 'x-ea-locale';
/** The visitor's remembered choice; set only by the language switch. */
export const LOCALE_COOKIE = 'ea_lang';
export const LOCALE_COOKIE_MAX_AGE = 365 * 24 * 60 * 60;

export function isLocale(value: unknown): value is Locale {
  return typeof value === 'string' && (LOCALES as readonly string[]).includes(value);
}

/**
 * The languages switched on (`PUBLIC_LOCALES=en,bn`). English is always
 * on; anything unknown is ignored, so a typo turns Bangla off, not the site.
 */
export function publicLocales(value: string | undefined): Locale[] {
  const wanted = new Set((value ?? '').split(',').map((s) => s.trim()));
  return LOCALES.filter((l) => l === DEFAULT_LOCALE || wanted.has(l));
}

/**
 * Paths that stay English only: no `/bn` form, no language redirect. Files
 * (robots.txt, sitemap.xml, the icons and manifest) have one form for all.
 */
export function isEnglishOnly(path: string): boolean {
  return (
    /^\/(admin|door|api|_next)(\/|$)/.test(path) ||
    /\.[a-z0-9]+$/i.test(path) ||
    /^\/(icon|apple-icon|manifest)(\/|$)/.test(path)
  );
}

/** `/bn/events/x` → Bangla, `/events/x`; anything else is English as it stands. */
export function localeFromPath(pathname: string): { locale: Locale; path: string } {
  if (pathname === '/bn' || pathname.startsWith('/bn/')) {
    return { locale: 'bn', path: pathname.slice(3) || '/' };
  }
  return { locale: 'en', path: pathname };
}

/**
 * An in-site link in `locale`. Only root-relative paths change (not
 * `https://…`, `mailto:`, `#…`, or `//host`), and never the English-only areas.
 */
export function localisedPath(href: string, locale: Locale): string {
  if (locale === DEFAULT_LOCALE) return href;
  if (!href.startsWith('/') || href.startsWith('//')) return href;
  const [path = '/', ...rest] = href.split(/(?=[?#])/);
  if (isEnglishOnly(path) || localeFromPath(path).locale === 'bn') return href;
  return `/bn${path === '/' ? '' : path}${rest.join('')}`;
}

export type LocaleStep =
  | { kind: 'next'; locale: Locale }
  | { kind: 'rewrite'; locale: Locale; path: string }
  | { kind: 'redirect'; to: string };

/**
 * The proxy's language step. `/bn/…` with Bangla on is rewritten to the
 * English route; with Bangla off it falls through to Next's own 404 (no
 * route lives at /bn). A visitor who chose Bangla and opens an English
 * link is sent to its `/bn` form once — there is no guessing from
 * Accept-Language (the edge cache would serve that guess to everyone).
 */
export function localeStep({
  pathname,
  search,
  method,
  cookie,
  locales,
}: {
  pathname: string;
  search: string;
  method: string;
  cookie: string | undefined;
  locales: readonly Locale[];
}): LocaleStep {
  if (isEnglishOnly(pathname)) return { kind: 'next', locale: DEFAULT_LOCALE };
  const bnOn = locales.includes('bn');
  const { locale, path } = localeFromPath(pathname);
  if (locale === 'bn') {
    return bnOn ? { kind: 'rewrite', locale, path } : { kind: 'next', locale: DEFAULT_LOCALE };
  }
  // Only page views: a server action posts to the page's own path, and a
  // redirect would drop it.
  if (bnOn && cookie === 'bn' && (method === 'GET' || method === 'HEAD')) {
    const to = localisedPath(pathname, 'bn');
    // Never a redirect off the site: `//host/…` stays as it is.
    if (to.startsWith('/bn')) return { kind: 'redirect', to: `${to}${search}` };
  }
  return { kind: 'next', locale: DEFAULT_LOCALE };
}
