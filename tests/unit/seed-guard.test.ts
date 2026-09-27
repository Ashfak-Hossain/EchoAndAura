import { describe, expect, it } from 'vitest';
import { SeedTargetError, assertSeedTarget } from '../../scripts/seed/guard';

/** The dev seed (and its --reset) must never touch anything but a local dev database. */
const LOCAL = 'postgres://localhost:5432/echoandaura';

describe('assertSeedTarget', () => {
  it('allows a local dev database', () => {
    expect(assertSeedTarget({}, LOCAL)).toEqual({ host: 'localhost', database: 'echoandaura' });
    expect(assertSeedTarget({ APP_ENV: 'development' }, 'postgres://127.0.0.1/dev').database).toBe(
      'dev',
    );
    expect(assertSeedTarget({}, 'postgres://postgres:5432/dev').host).toBe('postgres');
  });

  it.each([
    ['APP_ENV production', { APP_ENV: 'production' }, LOCAL],
    ['APP_ENV staging', { APP_ENV: 'Staging' }, LOCAL],
    ['NODE_ENV production', { NODE_ENV: 'production' }, LOCAL],
    ['a remote host', {}, 'postgres://db.example.com:5432/echoandaura'],
    ['the e2e database', {}, 'postgres://localhost:5432/echoandaura_e2e'],
    ['no database name', {}, 'postgres://localhost:5432/'],
    ['no DATABASE_URL', {}, undefined],
    ['a malformed URL', {}, 'not a url'],
  ])('refuses %s', (_label, env, url) => {
    expect(() => assertSeedTarget(env, url)).toThrow(SeedTargetError);
  });
});
