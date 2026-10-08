import type { NextConfig } from 'next';
import createNextIntlPlugin from 'next-intl/plugin';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { coverImagesConfig } from './src/lib/image-config';

const covers = coverImagesConfig();
if (covers.remotePatterns.length === 0) {
  console.warn('R2_PUBLIC_URL is not set: event covers will not load from this build.');
}

const nextConfig: NextConfig = {
  // Generated only in the explicitly opted-in image build; uploaded and
  // removed before the static assets or standalone server leave that stage.
  productionBrowserSourceMaps: process.env.SENTRY_BUILD_SOURCEMAPS === '1',
  compiler: {
    runAfterProductionCompile: async ({ distDir, projectDir }) => {
      if (process.env.SENTRY_BUILD_SOURCEMAPS === '1') {
        execFileSync(
          process.execPath,
          [join(projectDir, 'scripts/error-tracking-build.mjs'), 'inject-next', distDir],
          { cwd: projectDir, stdio: 'inherit' },
        );
      }
    },
  },
  // `next dev` and `next build` must never share a folder: a build (verify,
  // Playwright) running beside the dev server corrupts Turbopack's cache and
  // the dev typegen. The build/start/typegen scripts set NEXT_DIST_DIR to
  // `.next-build`; dev keeps the default `.next`.
  distDir: process.env.NEXT_DIST_DIR ?? '.next',
  // ADR-036: the Docker image runs Next's standalone server (only the
  // files the server traces, ~10x smaller than node_modules). Set by the
  // Dockerfile only: `pnpm start` (Playwright, local checks) keeps
  // `next start`, which does not support a standalone build.
  output: process.env.NEXT_OUTPUT === 'standalone' ? 'standalone' : undefined,
  // react-pdf carries its own bundled runtime; let Node load it as-is.
  serverExternalPackages: ['@react-pdf/renderer'],
  // Phone testing of the gate scanner goes through a cloudflared quick
  // tunnel (a real certificate, which the camera needs); `next dev` blocks
  // other hosts by default. Dev-only: production ignores this setting.
  allowedDevOrigins: ['*.trycloudflare.com'],
  // ADR-033: event covers go through the optimizer, which may fetch only
  // from the storage host (built from R2_PUBLIC_URL at build time).
  images: {
    ...covers,
    // Every upload gets a new key (coverImageKey), so a URL's bytes never
    // change: a long cache can't serve a stale cover.
    minimumCacheTTL: 31 * 24 * 60 * 60,
    // The defaults without 3840: covers are ~1200 wide, and a 4K variant
    // of a 5 MB source would cost CPU for no visible gain.
    deviceSizes: [640, 750, 828, 1080, 1200, 1920, 2048],
  },
  // ADR-043: no `X-Powered-By: Next.js` advert.
  poweredByHeader: false,
  headers() {
    return Promise.resolve([
      {
        // ADR-043: every response. First on purpose: a later rule that
        // sets the same header (the /door rules below) wins. The CSP is
        // per request, so it lives in src/proxy.ts instead.
        source: '/:path*',
        headers: [
          // A year of HTTPS-only, subdomains included (deploy, media are
          // HTTPS already). No `preload`: leaving the browser list is slow.
          { key: 'Strict-Transport-Security', value: 'max-age=31536000; includeSubDomains' },
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          // Old browsers; modern ones follow the CSP's frame-ancestors.
          { key: 'X-Frame-Options', value: 'DENY' },
          {
            key: 'Permissions-Policy',
            value: 'camera=(), microphone=(), geolocation=(), payment=()',
          },
          { key: 'Cross-Origin-Opener-Policy', value: 'same-origin' },
        ],
      },
      {
        // ADR-030: the gate scanner. No referrer (the page once carried
        // the pass code in its fragment), no framing, and only this origin
        // may ask for the camera. The page and the API are dynamic, so
        // Next already sends no-store; the API sets it itself too.
        source: '/door/:path*',
        headers: [
          { key: 'Referrer-Policy', value: 'no-referrer' },
          { key: 'X-Frame-Options', value: 'DENY' },
          { key: 'Permissions-Policy', value: 'camera=(self)' },
          { key: 'X-Content-Type-Options', value: 'nosniff' },
        ],
      },
      {
        // ADR-035: the door's service worker (built into public/door/). It
        // lives in /door/ but controls the /door page itself, one level up,
        // which the browser allows only when the script says so. Always
        // revalidated: a fix to the worker must reach phones at once.
        source: '/door/sw.js',
        headers: [
          { key: 'Service-Worker-Allowed', value: '/door' },
          { key: 'Cache-Control', value: 'no-cache' },
        ],
      },
      {
        // Self-hosted decoder; the version is in the filename.
        source: '/vendor/:file*',
        headers: [{ key: 'Cache-Control', value: 'public, max-age=31536000, immutable' }],
      },
    ]);
  },
};

// ADR-061: next-intl reads its per-request config (locale, messages) from here.
const withNextIntl = createNextIntlPlugin('./src/i18n/request.ts');

export default withNextIntl(nextConfig);
