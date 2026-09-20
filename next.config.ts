import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  // `next dev` and `next build` must never share a folder: a build (verify,
  // Playwright) running beside the dev server corrupts Turbopack's cache and
  // the dev typegen. The build/start/typegen scripts set NEXT_DIST_DIR to
  // `.next-build`; dev keeps the default `.next`.
  distDir: process.env.NEXT_DIST_DIR ?? '.next',
  // react-pdf carries its own bundled runtime; let Node load it as-is.
  serverExternalPackages: ['@react-pdf/renderer'],
};

export default nextConfig;
