import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  // react-pdf carries its own bundled runtime; let Node load it as-is.
  serverExternalPackages: ['@react-pdf/renderer'],
};

export default nextConfig;
