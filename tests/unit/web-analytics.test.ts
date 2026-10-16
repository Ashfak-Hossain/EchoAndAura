import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { NextRequest } from 'next/server';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { WebAnalytics } from '@/components/public/web-analytics';
import { buildCsp } from '@/lib/csp';
import {
  BEACON_REPORT_ORIGIN,
  BEACON_SRC,
  beaconConfig,
  isMeasuredPath,
  nonceFromCsp,
  webAnalyticsToken,
} from '@/lib/web-analytics';

const requestHeaders = vi.hoisted(() => ({ current: new Headers() }));
vi.mock('next/headers', () => ({ headers: async () => requestHeaders.current }));

/** ADR-077, ADR-079: which pages Cloudflare Web Analytics measures. */
const TOKEN = '0123456789abcdef0123456789abcdef';

describe('webAnalyticsToken', () => {
  it('accepts 32 hex characters, trimmed and lowercased', () => {
    expect(webAnalyticsToken(TOKEN)).toBe(TOKEN);
    expect(webAnalyticsToken(` ${TOKEN.toUpperCase()}\n`)).toBe(TOKEN);
  });

  it.each([undefined, '', '   ', 'abc', `${TOKEN}0`, `${TOKEN.slice(0, 31)}g`, '"},"x":"'])(
    'refuses %j, so the beacon stays off',
    (raw) => {
      expect(webAnalyticsToken(raw)).toBeNull();
    },
  );
});

describe('isMeasuredPath', () => {
  it.each([
    '/',
    '/events',
    '/events/dhaka-nights',
    '/archive',
    '/about',
    '/faq',
    '/contact',
    '/privacy',
    '/refund',
    '/terms',
  ])('measures the public page %s', (path) => {
    expect(isMeasuredPath(path)).toBe(true);
  });

  it.each([
    // Addresses that are access keys (ADR-012, ADR-015), and the form
    // that redirects into one without a page load.
    '/tickets/ABCD-1234',
    '/orders/0b7f4c1e-0000-4000-8000-000000000000',
    '/orders/find',
    '/events/dhaka-nights/register',
    // Signed-in or staff pages.
    '/account',
    '/account/tickets',
    '/admin',
    '/admin/orders',
    '/door',
    // `/bn/…` before the rewrite, and routes nobody has allowed yet.
    '/bn/tickets/ABCD-1234',
    '/new-page',
    // Whole routes only: a deeper path under a measured one, or an empty
    // first segment, is not the page on the list.
    '/events/dhaka-nights/anything',
    '/events/',
    '//tickets/ABCD-1234',
    '/about/x',
    // Routes are case-sensitive; `/bn` is judged after the rewrite.
    '/Events',
    '/EVENTS/dhaka-nights',
    '/bn',
  ])('never measures %s', (path) => {
    expect(isMeasuredPath(path)).toBe(false);
  });
});

/** Every file under `root`, as paths relative to it with `/` separators. */
function filesUnder(root: string, dir = join(process.cwd(), root)): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return filesUnder(root, path);
    return [relative(join(process.cwd(), root), path).split(sep).join('/')];
  });
}

const appFiles = () => filesUnder('src/app');

/** A page file's URL, with `x` for each dynamic segment and the groups dropped. */
function routeOf(page: string): string {
  const segments = page
    .split('/')
    .slice(0, -1)
    .filter((segment) => !/^\(.+\)$/.test(segment))
    .map((segment) => (/^\[.+\]$/.test(segment) ? 'x' : segment));
  return `/${segments.join('/')}`;
}

// ADR-079: the (measured) root layout renders the beacon; the proxy's
// allowlist opens connect-src. They must name the same pages: a page added
// to (measured) without the allowlist sends nothing, one added to the
// allowlist outside (measured) never has the beacon, and either is a test
// failure here rather than a surprise on the dashboard.
describe('the allowlist is the (measured) root', () => {
  const pages = appFiles().filter((file) => /(^|\/)page\.(tsx?|jsx?|mdx?)$/.test(file));

  it('finds the pages', () => {
    expect(pages.filter((page) => page.startsWith('(measured)/')).length).toBeGreaterThan(5);
    expect(pages.length).toBeGreaterThan(20);
  });

  it.each(pages)('%s', (page) => {
    expect(isMeasuredPath(routeOf(page))).toBe(page.startsWith('(measured)/'));
  });

  // routeOf reads `[...slug]` as one segment, so a catch-all under
  // (measured) would pass the check above while serving deeper addresses
  // the allowlist never names, and the beacon (spa: true) would report them.
  it('has no catch-all segment under (measured)', () => {
    expect(pages.filter((page) => page.startsWith('(measured)/') && page.includes('[...'))).toEqual(
      [],
    );
  });

  // All of src, not only src/app: the shared public shell renders in both
  // public roots, the admin 404 and the global 404, so the beacon there
  // would run on the order page. Specifiers are resolved, so a relative
  // import, a re-export, a dynamic import or a require counts too.
  it('renders the beacon only from the (measured) layout', () => {
    const src = join(process.cwd(), 'src');
    const beacon = join(src, 'components/public/web-analytics');
    const importsBeacon = (file: string) =>
      [
        ...readFileSync(join(src, file), 'utf8').matchAll(
          /(?:\bfrom|\bimport\s*\(|\brequire\s*\()\s*(?:\/\*[\s\S]*?\*\/\s*)?['"`]([^'"`]+)['"`]/g,
        ),
      ]
        .map((match) => match[1] ?? '')
        .some((spec) => {
          const target = spec.startsWith('@/')
            ? join(src, spec.slice(2))
            : spec.startsWith('.')
              ? resolve(dirname(join(src, file)), spec)
              : null;
          return target?.replace(/\.[cm]?[jt]sx?$/, '') === beacon;
        });
    const users = filesUnder('src')
      .filter((file) => /\.(?:[cm]?[jt]sx?|mdx)$/.test(file))
      .filter(importsBeacon);
    expect(users).toEqual(['app/(measured)/layout.tsx']);
  });

  // The test above guards the component. This one guards the script itself:
  // a page that wrote its own <script src={BEACON_SRC}> would skip it.
  it('names the beacon only in its own two files', () => {
    const naming = filesUnder('src').filter((file) =>
      /BEACON_SRC|beaconConfig|cloudflareinsights/.test(readFileSync(join('src', file), 'utf8')),
    );
    expect(naming.sort()).toEqual(['components/public/web-analytics.tsx', 'lib/web-analytics.ts']);
  });
});

describe('WebAnalytics', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  const csp = buildCsp({
    nonce: 'YWJjZA==',
    mediaOrigin: null,
    uploadOrigin: null,
    door: false,
    dev: false,
  });

  async function render(headers: Record<string, string>, env = TOKEN) {
    vi.stubEnv('CF_WEB_ANALYTICS_TOKEN', env);
    requestHeaders.current = new Headers(headers);
    return renderToStaticMarkup(await WebAnalytics());
  }

  it("renders the beacon with this request's nonce and the token", async () => {
    const html = await render({ 'content-security-policy': csp });
    expect(html).toContain(`src="${BEACON_SRC}"`);
    expect(html).toContain('defer');
    expect(html).toContain('nonce="YWJjZA=="');
    expect(html).toContain(TOKEN);
  });

  it.each(['', 'not-a-token'])('renders nothing with the token %j', async (env) => {
    expect(await render({ 'content-security-policy': csp }, env)).toBe('');
  });

  it('renders nothing without a policy to take the nonce from', async () => {
    expect(await render({})).toBe('');
  });
});

describe('nonceFromCsp and beaconConfig', () => {
  it('reads back the nonce buildCsp wrote', () => {
    const csp = buildCsp({
      nonce: 'YWJjZA==',
      mediaOrigin: null,
      uploadOrigin: null,
      door: false,
      dev: false,
    });
    expect(nonceFromCsp(csp)).toBe('YWJjZA==');
    expect(nonceFromCsp(null)).toBeNull();
    expect(nonceFromCsp("script-src 'self'")).toBeNull();
  });

  it('counts in-app navigations', () => {
    expect(JSON.parse(beaconConfig(TOKEN))).toEqual({ token: TOKEN, spa: true });
  });
});

describe('proxy — where reports may go', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  async function connectSrc(path: string, headers: Record<string, string> = {}) {
    vi.resetModules();
    const { proxy } = await import('@/proxy');
    const res = await proxy(
      new NextRequest(new URL(path, 'https://echoandaura.com'), { headers: new Headers(headers) }),
    );
    const csp = res.headers.get('content-security-policy') ?? '';
    return /connect-src ([^;]*)/.exec(csp)?.[1]?.split(' ') ?? [];
  }

  it('lets a measured page report', async () => {
    vi.stubEnv('CF_WEB_ANALYTICS_TOKEN', TOKEN);
    expect(await connectSrc('/events/dhaka-nights')).toContain(BEACON_REPORT_ORIGIN);
  });

  it.each(['/tickets/ABCD-1234', '/orders/0b7f4c1e-0000-4000-8000-000000000000', '/account'])(
    'keeps %s from reporting',
    async (path) => {
      vi.stubEnv('CF_WEB_ANALYTICS_TOKEN', TOKEN);
      expect(await connectSrc(path)).not.toContain(BEACON_REPORT_ORIGIN);
    },
  );

  it('judges a Bangla page by its English route', async () => {
    vi.stubEnv('CF_WEB_ANALYTICS_TOKEN', TOKEN);
    vi.stubEnv('PUBLIC_LOCALES', 'en,bn');
    expect(await connectSrc('/bn/events')).toContain(BEACON_REPORT_ORIGIN);
    expect(await connectSrc('/bn/tickets/ABCD-1234')).not.toContain(BEACON_REPORT_ORIGIN);
  });

  it('measures no /bn page while Bangla is off', async () => {
    vi.stubEnv('CF_WEB_ANALYTICS_TOKEN', TOKEN);
    vi.stubEnv('PUBLIC_LOCALES', 'en');
    expect(await connectSrc('/bn/events')).not.toContain(BEACON_REPORT_ORIGIN);
  });

  it('never lets a signed-in admin page report', async () => {
    vi.stubEnv('CF_WEB_ANALYTICS_TOKEN', TOKEN);
    const connect = await connectSrc('/admin/orders', { cookie: 'better-auth.session_token=x' });
    expect(connect).not.toContain(BEACON_REPORT_ORIGIN);
  });

  it('lets nothing report without a valid token', async () => {
    vi.stubEnv('CF_WEB_ANALYTICS_TOKEN', 'not-a-token');
    expect(await connectSrc('/')).not.toContain(BEACON_REPORT_ORIGIN);
  });
});
