import type { NextConfig } from 'next';

type ImagesConfig = NonNullable<NextConfig['images']>;
type RemotePattern = Exclude<NonNullable<ImagesConfig['remotePatterns']>[number], URL>;

export interface CoverImagesConfig {
  remotePatterns: RemotePattern[];
  dangerouslyAllowLocalIP: boolean;
}

/** Where a build must know the storage host: a missing value there breaks every cover. */
const DEPLOYED_APP_ENVS = new Set(['staging', 'production']);

/**
 * ADR-033: Next's image optimizer fetches covers from object storage, so
 * `images.remotePatterns` must name that host — and only that host, since
 * the optimizer is a server-side fetcher anyone can point at a URL. The
 * pattern is built from `R2_PUBLIC_URL`, the same base `storage.publicUrl`
 * prefixes every cover key with (ADR-007).
 *
 * Read at build time: Next bakes the allow-list into the build, so moving
 * the bucket or domain means a rebuild.
 *
 * Local IPs are allowed only when the storage URL itself is loopback (MinIO
 * at localhost:9000 in dev and e2e). Deciding by the URL, not by APP_ENV,
 * keeps a production build with a public R2 host from ever fetching a
 * private address.
 *
 * @throws when R2_PUBLIC_URL is not an http(s) URL, or is missing from a
 *   staging/production build.
 */
export function coverImagesConfig(env: NodeJS.ProcessEnv = process.env): CoverImagesConfig {
  const raw = env.R2_PUBLIC_URL?.trim();
  if (!raw) {
    if (DEPLOYED_APP_ENVS.has(env.APP_ENV ?? '')) {
      throw new Error(
        `R2_PUBLIC_URL is not set for an ${env.APP_ENV} build — covers would not load. See docs/ENVIRONMENT.md § Object storage`,
      );
    }
    // CI's `pnpm verify` builds without storage env and renders no cover.
    return { remotePatterns: [], dangerouslyAllowLocalIP: false };
  }

  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error(
      `R2_PUBLIC_URL is not a valid URL: "${raw}" — see docs/ENVIRONMENT.md § Object storage`,
    );
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error(
      `R2_PUBLIC_URL must be http or https, got "${url.protocol}" — see docs/ENVIRONMENT.md § Object storage`,
    );
  }

  // Same normalisation as readStorageEnv: no trailing slash on the base.
  const basePath = url.pathname.replace(/\/+$/, '');
  return {
    remotePatterns: [
      {
        protocol: url.protocol === 'http:' ? 'http' : 'https',
        hostname: url.hostname,
        // '' means the default port only.
        port: url.port,
        pathname: `${basePath}/**`,
        // Cover URLs never carry a query string.
        search: '',
      },
    ],
    dangerouslyAllowLocalIP: isLoopback(url.hostname),
  };
}

function isLoopback(hostname: string): boolean {
  return hostname === 'localhost' || hostname === '[::1]' || /^127(\.\d{1,3}){3}$/.test(hostname);
}
