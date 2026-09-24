import type { NextConfig } from 'next';

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
