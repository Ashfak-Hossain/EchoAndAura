import type { NextConfig } from 'next';
import { coverImagesConfig } from './src/lib/image-config';

const covers = coverImagesConfig();
if (covers.remotePatterns.length === 0) {
  console.warn('R2_PUBLIC_URL is not set: event covers will not load from this build.');
}

const nextConfig: NextConfig = {
  // `next dev` and `next build` must never share a folder: a build (verify,
  // Playwright) running beside the dev server corrupts Turbopack's cache and
  // the dev typegen. The build/start/typegen scripts set NEXT_DIST_DIR to
  // `.next-build`; dev keeps the default `.next`.
  distDir: process.env.NEXT_DIST_DIR ?? '.next',
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
  headers() {
    return Promise.resolve([
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
        // Self-hosted decoder; the version is in the filename.
        source: '/vendor/:file*',
        headers: [{ key: 'Cache-Control', value: 'public, max-age=31536000, immutable' }],
      },
    ]);
  },
};

export default nextConfig;
