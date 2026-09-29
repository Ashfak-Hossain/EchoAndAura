import { describe, expect, it } from 'vitest';
import { buildCsp, newNonce, originFrom } from '@/lib/csp';

function directives(csp: string): Map<string, string[]> {
  return new Map(
    csp.split('; ').map((d) => {
      const [name = '', ...values] = d.split(' ');
      return [name, values];
    }),
  );
}

const base = { nonce: 'abc123', mediaOrigin: null, uploadOrigin: null, door: false, dev: false };

describe('buildCsp', () => {
  it('allows only scripts with this request nonce, and whatever they load', () => {
    const d = directives(buildCsp(base));
    expect(d.get('script-src')).toEqual(["'self'", "'nonce-abc123'", "'strict-dynamic'"]);
    expect(d.get('script-src')).not.toContain("'unsafe-inline'");
  });

  it('locks down framing, plugins, base and form targets', () => {
    const d = directives(buildCsp(base));
    expect(d.get('frame-ancestors')).toEqual(["'none'"]);
    expect(d.get('object-src')).toEqual(["'none'"]);
    expect(d.get('base-uri')).toEqual(["'self'"]);
    expect(d.get('form-action')).toEqual(["'self'"]);
    expect(d.get('default-src')).toEqual(["'self'"]);
  });

  it('adds WebAssembly compilation on the door only', () => {
    expect(directives(buildCsp(base)).get('script-src')).not.toContain("'wasm-unsafe-eval'");
    expect(directives(buildCsp({ ...base, door: true })).get('script-src')).toContain(
      "'wasm-unsafe-eval'",
    );
  });

  it('adds eval in development only', () => {
    expect(directives(buildCsp(base)).get('script-src')).not.toContain("'unsafe-eval'");
    expect(directives(buildCsp({ ...base, dev: true })).get('script-src')).toContain(
      "'unsafe-eval'",
    );
  });

  it('lets the page reach only its own origin, plus storage when uploading', () => {
    expect(directives(buildCsp(base)).get('connect-src')).toEqual(["'self'"]);
    expect(
      directives(buildCsp({ ...base, uploadOrigin: 'https://acct.r2.cloudflarestorage.com' })).get(
        'connect-src',
      ),
    ).toEqual(["'self'", 'https://acct.r2.cloudflarestorage.com']);
  });

  it('allows images from the media origin when there is one', () => {
    expect(directives(buildCsp(base)).get('img-src')).toEqual(["'self'", 'data:', 'blob:']);
    expect(
      directives(buildCsp({ ...base, mediaOrigin: 'https://media.example.com' })).get('img-src'),
    ).toEqual(["'self'", 'data:', 'blob:', 'https://media.example.com']);
  });
});

describe('originFrom', () => {
  it('keeps the origin and drops the path', () => {
    expect(originFrom('https://media.example.com/covers')).toBe('https://media.example.com');
    expect(originFrom(' http://localhost:9000/echoandaura-media ')).toBe('http://localhost:9000');
  });

  it('returns null when unset or not an http(s) URL', () => {
    expect(originFrom(undefined)).toBeNull();
    expect(originFrom('')).toBeNull();
    expect(originFrom('not a url')).toBeNull();
    expect(originFrom('ftp://media.example.com')).toBeNull();
  });
});

describe('newNonce', () => {
  it('is base64 and different every time', () => {
    const a = newNonce();
    expect(a).toMatch(/^[A-Za-z0-9+/]+=*$/);
    expect(newNonce()).not.toBe(a);
  });
});
