import { describe, expect, it } from 'vitest';
import { coverImagesConfig } from '@/lib/image-config';

const cfg = (env: Record<string, string>) => coverImagesConfig(env as NodeJS.ProcessEnv);

describe('coverImagesConfig', () => {
  it('local MinIO: the bucket path only, and loopback may be fetched', () => {
    expect(cfg({ R2_PUBLIC_URL: 'http://localhost:9000/echoandaura' })).toEqual({
      remotePatterns: [
        {
          protocol: 'http',
          hostname: 'localhost',
          port: '9000',
          pathname: '/echoandaura/**',
          search: '',
        },
      ],
      dangerouslyAllowLocalIP: true,
    });
  });

  it('an R2 custom domain: https, default port, the whole host, no local IPs', () => {
    expect(cfg({ R2_PUBLIC_URL: 'https://img.example.com' })).toEqual({
      remotePatterns: [
        { protocol: 'https', hostname: 'img.example.com', port: '', pathname: '/**', search: '' },
      ],
      dangerouslyAllowLocalIP: false,
    });
  });

  it('an r2.dev URL is not loopback', () => {
    const out = cfg({ R2_PUBLIC_URL: 'https://pub-abc123.r2.dev' });
    expect(out.remotePatterns[0]).toMatchObject({ hostname: 'pub-abc123.r2.dev', pathname: '/**' });
    expect(out.dangerouslyAllowLocalIP).toBe(false);
  });

  it('strips trailing slashes, like readStorageEnv', () => {
    expect(
      cfg({ R2_PUBLIC_URL: 'http://localhost:9000/echoandaura//' }).remotePatterns[0],
    ).toMatchObject({
      pathname: '/echoandaura/**',
    });
    expect(cfg({ R2_PUBLIC_URL: 'https://img.example.com/' }).remotePatterns[0]).toMatchObject({
      pathname: '/**',
    });
  });

  it('127.x and [::1] count as loopback', () => {
    expect(cfg({ R2_PUBLIC_URL: 'http://127.0.0.1:9000/b' }).dangerouslyAllowLocalIP).toBe(true);
    expect(cfg({ R2_PUBLIC_URL: 'http://[::1]:9000/b' }).dangerouslyAllowLocalIP).toBe(true);
  });

  it('a private-looking hostname that is not loopback never allows local IPs', () => {
    // e.g. a Docker service name: it resolves to a private address, which is
    // exactly what the optimizer must refuse outside a loopback setup.
    expect(cfg({ R2_PUBLIC_URL: 'http://minio:9000/echoandaura' }).dangerouslyAllowLocalIP).toBe(
      false,
    );
    expect(cfg({ R2_PUBLIC_URL: 'http://127.example.com/b' }).dangerouslyAllowLocalIP).toBe(false);
  });

  it('unset: no host is allowed (CI builds without storage env)', () => {
    expect(cfg({})).toEqual({ remotePatterns: [], dangerouslyAllowLocalIP: false });
    expect(cfg({ R2_PUBLIC_URL: '  ', APP_ENV: 'test' })).toEqual({
      remotePatterns: [],
      dangerouslyAllowLocalIP: false,
    });
  });

  it.each(['production', 'staging'])('unset in a %s build: refuses to build', (APP_ENV) => {
    expect(() => cfg({ APP_ENV })).toThrow(/R2_PUBLIC_URL is not set/);
  });

  it('a malformed URL throws', () => {
    expect(() => cfg({ R2_PUBLIC_URL: 'localhost:9000/echoandaura/x y' })).toThrow();
    expect(() => cfg({ R2_PUBLIC_URL: 'not a url' })).toThrow(/not a valid URL/);
  });

  it('a non-http protocol throws', () => {
    expect(() => cfg({ R2_PUBLIC_URL: 'ftp://files.example.com/covers' })).toThrow(
      /must be http or https/,
    );
  });
});
