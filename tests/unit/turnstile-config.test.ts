import { describe, expect, it } from 'vitest';
import {
  readTurnstileConfig,
  TURNSTILE_TEST_SECRET_KEY,
  TURNSTILE_TEST_SITE_KEY,
} from '@/lib/turnstile-config';

const cfg = (env: Record<string, string>) => readTurnstileConfig(env as NodeJS.ProcessEnv);

const REAL_SITE = '0x4AAAAAAAreal-site-key';
const REAL_SECRET = '0x4AAAAAAAreal-secret-key';
const real = { TURNSTILE_SITE_KEY: REAL_SITE, TURNSTILE_SECRET_KEY: REAL_SECRET };

describe('readTurnstileConfig — local, test and load stacks', () => {
  it.each<Record<string, string>>([{}, { APP_ENV: 'development' }, { APP_ENV: 'test' }])(
    'defaults to the test keys and skips the host/action claims (%o)',
    (env) => {
      expect(cfg(env)).toEqual({
        siteKey: TURNSTILE_TEST_SITE_KEY,
        secretKey: TURNSTILE_TEST_SECRET_KEY,
        expectedHostname: null,
      });
    },
  );

  it('treats whitespace-only keys as unset', () => {
    expect(cfg({ TURNSTILE_SITE_KEY: '  ', TURNSTILE_SECRET_KEY: '\n' })).toMatchObject({
      siteKey: TURNSTILE_TEST_SITE_KEY,
      secretKey: TURNSTILE_TEST_SECRET_KEY,
    });
  });

  it('accepts real keys outside a deployed env and checks the host', () => {
    expect(cfg({ ...real, SITE_URL: 'http://localhost:3000' })).toEqual({
      siteKey: REAL_SITE,
      secretKey: REAL_SECRET,
      expectedHostname: 'localhost',
    });
  });
});

describe.each(['production', 'staging'])('readTurnstileConfig — %s', (APP_ENV) => {
  const site = 'https://echoandaura.com';

  it('throws when the site key is missing', () => {
    expect(() => cfg({ APP_ENV, SITE_URL: site, TURNSTILE_SECRET_KEY: REAL_SECRET })).toThrow(
      /TURNSTILE_SITE_KEY and TURNSTILE_SECRET_KEY must be set/,
    );
  });

  it('throws when the secret is missing or blank', () => {
    expect(() => cfg({ APP_ENV, SITE_URL: site, TURNSTILE_SITE_KEY: REAL_SITE })).toThrow(
      /must be set/,
    );
    expect(() =>
      cfg({ APP_ENV, SITE_URL: site, TURNSTILE_SITE_KEY: REAL_SITE, TURNSTILE_SECRET_KEY: ' ' }),
    ).toThrow(/must be set/);
  });

  it.each([
    ['the test site key', { ...real, TURNSTILE_SITE_KEY: TURNSTILE_TEST_SITE_KEY }],
    ['the test secret', { ...real, TURNSTILE_SECRET_KEY: TURNSTILE_TEST_SECRET_KEY }],
    // The always-blocks / forced-challenge test keys are test keys too.
    ['a 2x test site key', { ...real, TURNSTILE_SITE_KEY: '2x00000000000000000000AB' }],
    ['a 3x test secret', { ...real, TURNSTILE_SECRET_KEY: '3x0000000000000000000000000000000AA' }],
  ])('refuses %s — it accepts a public dummy token', (_label, keys) => {
    expect(() => cfg({ APP_ENV, SITE_URL: site, ...keys })).toThrow(/test keys are not allowed/);
  });

  it('takes the expected host from SITE_URL, trimming the keys', () => {
    expect(
      cfg({
        APP_ENV,
        SITE_URL: 'https://echoandaura.com/',
        TURNSTILE_SITE_KEY: ` ${REAL_SITE} `,
        TURNSTILE_SECRET_KEY: `${REAL_SECRET}\n`,
      }),
    ).toEqual({ siteKey: REAL_SITE, secretKey: REAL_SECRET, expectedHostname: 'echoandaura.com' });
  });

  it('falls back to BETTER_AUTH_URL for the host, as siteUrl does', () => {
    expect(
      cfg({ APP_ENV, BETTER_AUTH_URL: 'https://tickets.echoandaura.com', ...real })
        .expectedHostname,
    ).toBe('tickets.echoandaura.com');
  });

  it('throws when there is no site URL to check the host against', () => {
    expect(() => cfg({ APP_ENV, ...real })).toThrow(/SITE_URL is not set/);
  });
});
