import { NextRequest } from 'next/server';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { WebAnalytics } from '@/components/public/web-analytics';
import { buildCsp } from '@/lib/csp';
import {
  BEACON_REPORT_ORIGIN,
  BEACON_SRC,
  WEB_ANALYTICS_HEADER,
  beaconConfig,
  isMeasuredPath,
  needsFullLoad,
  takeOverClick,
  nonceFromCsp,
  webAnalyticsToken,
} from '@/lib/web-analytics';

const requestHeaders = vi.hoisted(() => ({ current: new Headers() }));
vi.mock('next/headers', () => ({ headers: async () => requestHeaders.current }));

/** ADR-077: which pages Cloudflare Web Analytics measures, and how the proxy says so. */
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

describe('needsFullLoad', () => {
  const here = 'https://echoandaura.com/events/dhaka-nights';

  it.each([
    '/events/dhaka-nights/register',
    '/orders/find',
    '/tickets/ABCD-1234',
    '/account/sign-in',
    'https://echoandaura.com/orders/0b7f4c1e-0000-4000-8000-000000000000?ref=x#pay',
    '/bn/tickets/ABCD-1234',
    'dhaka-nights/register', // relative: /events/dhaka-nights/register
    // Dot segments resolve before the allowlist sees them.
    '/events/%2e%2e/tickets/ABCD-1234',
    '/bn/%2e%2e/orders/0b7f4c1e-0000-4000-8000-000000000000',
    '/bn//tickets/ABCD-1234',
    '/events/', // a full load, then Next's trailing-slash redirect
  ])('leaves for %s with a full page load', (href) => {
    expect(needsFullLoad(href, here)).toBe(true);
  });

  it.each([
    '/',
    '/events',
    '/bn/events/other-show',
    '/faq#refunds',
    '/archive?year=2025',
    '#tickets',
    // Not our site: the browser leaves anyway.
    'https://www.facebook.com/echoandaura',
    'mailto:hello@example.com',
    'http://[bad',
    '//tickets/ABCD-1234', // protocol-relative: another host
    'javascript:void(0)',
    '/bn', // the Bangla home is measured
  ])('lets %s through', (href) => {
    expect(needsFullLoad(href, here)).toBe(false);
  });
});

describe('takeOverClick', () => {
  const here = 'https://echoandaura.com/events/dhaka-nights';
  const plain = {
    defaultPrevented: false,
    button: 0,
    metaKey: false,
    ctrlKey: false,
    shiftKey: false,
    altKey: false,
  };
  const toRegister = { href: `${here}/register`, target: '', download: false };

  it('takes a plain click to an unmeasured page of ours', () => {
    expect(takeOverClick(plain, toRegister, here)).toBe(true);
    expect(takeOverClick(plain, { ...toRegister, target: '_self' }, here)).toBe(true);
  });

  it.each([
    ['the middle button', { button: 1 }],
    ['cmd', { metaKey: true }],
    ['ctrl', { ctrlKey: true }],
    ['shift', { shiftKey: true }],
    ['alt', { altKey: true }],
    ['a click already handled', { defaultPrevented: true }],
  ])('leaves %s to the browser', (_name, change) => {
    expect(takeOverClick({ ...plain, ...change }, toRegister, here)).toBe(false);
  });

  it.each([
    ['a new tab', { target: '_blank' }],
    ['a download', { download: true }],
    ['a measured page', { href: 'https://echoandaura.com/faq' }],
    ['another site', { href: 'https://www.facebook.com/echoandaura' }],
  ])('leaves a link to %s alone', (_name, change) => {
    expect(takeOverClick(plain, { ...toRegister, ...change }, here)).toBe(false);
  });

  it('ignores a click on no link', () => {
    expect(takeOverClick(plain, null, here)).toBe(false);
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
    const html = await render({ [WEB_ANALYTICS_HEADER]: TOKEN, 'content-security-policy': csp });
    expect(html).toContain(`src="${BEACON_SRC}"`);
    expect(html).toContain('defer');
    expect(html).toContain('nonce="YWJjZA=="');
    expect(html).toContain(TOKEN);
  });

  it('renders nothing on an unmeasured page', async () => {
    expect(await render({ 'content-security-policy': csp })).toBe('');
  });

  it('renders nothing without a policy to take the nonce from', async () => {
    expect(await render({ [WEB_ANALYTICS_HEADER]: TOKEN })).toBe('');
  });

  // A path the proxy skips (`/api/nope`) renders the not-found page in
  // this layout with the visitor's own headers.
  it('renders nothing when the header is not our token', async () => {
    const other = 'fedcba9876543210fedcba9876543210';
    const spoofed = { [WEB_ANALYTICS_HEADER]: other, 'content-security-policy': csp };
    expect(await render(spoofed)).toBe('');
    expect(await render(spoofed, '')).toBe('');
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

describe('proxy — the analytics hand-off', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  async function run(path: string, headers: Record<string, string> = {}) {
    vi.resetModules();
    const { proxy } = await import('@/proxy');
    const res = await proxy(
      new NextRequest(new URL(path, 'https://echoandaura.com'), { headers: new Headers(headers) }),
    );
    const overrides = res.headers.get('x-middleware-override-headers')?.split(',') ?? [];
    const token = res.headers.get(`x-middleware-request-${WEB_ANALYTICS_HEADER}`);
    // Next forwards exactly the headers listed in the override list: a
    // visitor's header that is not on it is dropped, not passed through.
    expect(overrides.includes(WEB_ANALYTICS_HEADER)).toBe(token !== null);
    return {
      // NextResponse.next/rewrite carry the forwarded request headers this way.
      token,
      connect: /connect-src ([^;]*)/.exec(res.headers.get('content-security-policy') ?? '')?.[1],
    };
  }

  it('hands a measured page the token and lets it report', async () => {
    vi.stubEnv('CF_WEB_ANALYTICS_TOKEN', TOKEN);
    const { token, connect } = await run('/events/dhaka-nights');
    expect(token).toBe(TOKEN);
    expect(connect?.split(' ')).toContain(BEACON_REPORT_ORIGIN);
  });

  it.each(['/tickets/ABCD-1234', '/orders/0b7f4c1e-0000-4000-8000-000000000000', '/account'])(
    'gives %s neither the token nor the report origin',
    async (path) => {
      vi.stubEnv('CF_WEB_ANALYTICS_TOKEN', TOKEN);
      const { token, connect } = await run(path);
      expect(token).toBeNull();
      expect(connect?.split(' ')).not.toContain(BEACON_REPORT_ORIGIN);
    },
  );

  it('drops a token the visitor sent themselves', async () => {
    const spoofed = { [WEB_ANALYTICS_HEADER]: TOKEN };
    vi.stubEnv('CF_WEB_ANALYTICS_TOKEN', TOKEN);
    expect((await run('/tickets/ABCD-1234', spoofed)).token).toBeNull();
    vi.stubEnv('CF_WEB_ANALYTICS_TOKEN', '');
    const { token, connect } = await run('/', spoofed);
    expect(token).toBeNull();
    expect(connect?.split(' ')).not.toContain(BEACON_REPORT_ORIGIN);
  });

  it("replaces a visitor's own token with ours", async () => {
    vi.stubEnv('CF_WEB_ANALYTICS_TOKEN', TOKEN);
    const spoofed = { [WEB_ANALYTICS_HEADER]: 'fedcba9876543210fedcba9876543210' };
    expect((await run('/', spoofed)).token).toBe(TOKEN);
  });

  it("drops a visitor's token on a prefetch too", async () => {
    vi.stubEnv('CF_WEB_ANALYTICS_TOKEN', TOKEN);
    const spoofed = { [WEB_ANALYTICS_HEADER]: TOKEN, 'next-router-prefetch': '1' };
    expect((await run('/tickets/ABCD-1234', spoofed)).token).toBeNull();
  });

  it('judges a Bangla page by its English route', async () => {
    vi.stubEnv('CF_WEB_ANALYTICS_TOKEN', TOKEN);
    vi.stubEnv('PUBLIC_LOCALES', 'en,bn');
    expect((await run('/bn/events')).token).toBe(TOKEN);
    expect((await run('/bn/tickets/ABCD-1234')).token).toBeNull();
  });

  it('measures no /bn page while Bangla is off', async () => {
    vi.stubEnv('CF_WEB_ANALYTICS_TOKEN', TOKEN);
    vi.stubEnv('PUBLIC_LOCALES', 'en');
    expect((await run('/bn/events')).token).toBeNull();
  });

  it('never measures a signed-in admin page', async () => {
    vi.stubEnv('CF_WEB_ANALYTICS_TOKEN', TOKEN);
    const { token, connect } = await run('/admin/orders', {
      cookie: 'better-auth.session_token=x',
    });
    expect(token).toBeNull();
    expect(connect?.split(' ')).not.toContain(BEACON_REPORT_ORIGIN);
  });

  it('measures nothing without a valid token', async () => {
    vi.stubEnv('CF_WEB_ANALYTICS_TOKEN', 'not-a-token');
    const { token, connect } = await run('/');
    expect(token).toBeNull();
    expect(connect?.split(' ')).not.toContain(BEACON_REPORT_ORIGIN);
  });
});
