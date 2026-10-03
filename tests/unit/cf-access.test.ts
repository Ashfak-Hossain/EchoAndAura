import { createLocalJWKSet, exportJWK, generateKeyPair, SignJWT, type JWK } from 'jose';
import { beforeAll, describe, expect, it } from 'vitest';
import { createAccessVerifier, readAccessConfig, type AccessConfig } from '@/lib/cf-access';

/**
 * ADR-050: the origin's check of Cloudflare Access tokens. A real RSA key
 * pair signs the tokens; each test changes one claim (or the key) and
 * expects a refusal.
 */
const config: AccessConfig = { teamDomain: 'echoandaura.cloudflareaccess.com', aud: 'aud-admin' };
const ISSUER = 'https://echoandaura.cloudflareaccess.com';

let privateKey: CryptoKey;
let otherPrivateKey: CryptoKey;
let keys: ReturnType<typeof createLocalJWKSet>;

beforeAll(async () => {
  const pair = await generateKeyPair('RS256');
  privateKey = pair.privateKey;
  otherPrivateKey = (await generateKeyPair('RS256')).privateKey;
  const jwk: JWK = { ...(await exportJWK(pair.publicKey)), kid: 'k1', alg: 'RS256' };
  keys = createLocalJWKSet({ keys: [jwk] });
});

async function token(
  overrides: {
    iss?: string;
    aud?: string;
    exp?: number | string;
    key?: CryptoKey;
    alg?: string;
  } = {},
): Promise<string> {
  return new SignJWT({ email: 'admin@example.com' })
    .setProtectedHeader({ alg: overrides.alg ?? 'RS256', kid: 'k1' })
    .setIssuer(overrides.iss ?? ISSUER)
    .setAudience(overrides.aud ?? config.aud)
    .setIssuedAt()
    .setExpirationTime(overrides.exp ?? '1h')
    .sign(overrides.key ?? privateKey);
}

describe('createAccessVerifier', () => {
  it('accepts a token signed by the team for this application', async () => {
    expect(await createAccessVerifier(config, keys).verify(await token())).toBe(true);
  });

  it.each([
    ['no token', async () => undefined],
    ['an empty token', async () => ''],
    ['garbage', async () => 'not.a.jwt'],
    ['another application (aud)', () => token({ aud: 'aud-dokploy' })],
    ['another team (iss)', () => token({ iss: 'https://evil.cloudflareaccess.com' })],
    ['an expired token', () => token({ exp: Math.floor(Date.now() / 1000) - 60 })],
    ['a key that is not the team’s', () => token({ key: otherPrivateKey })],
  ])('refuses %s', async (_label, make) => {
    expect(await createAccessVerifier(config, keys).verify(await make())).toBe(false);
  });

  it('refuses an unsigned token (alg none)', async () => {
    const header = Buffer.from(JSON.stringify({ alg: 'none', kid: 'k1' })).toString('base64url');
    const body = Buffer.from(
      JSON.stringify({ iss: ISSUER, aud: config.aud, exp: Math.floor(Date.now() / 1000) + 3600 }),
    ).toString('base64url');
    expect(await createAccessVerifier(config, keys).verify(`${header}.${body}.`)).toBe(false);
  });
});

const read = (env: Record<string, string>) => readAccessConfig(env as NodeJS.ProcessEnv);

describe('readAccessConfig', () => {
  it('is off when neither setting is present', () => {
    expect(read({})).toBeNull();
  });

  it('reads both, trimming a scheme and trailing slash off the team domain', () => {
    expect(
      read({
        CF_ACCESS_TEAM_DOMAIN: ' https://echoandaura.cloudflareaccess.com/ ',
        CF_ACCESS_AUD: ' aud-admin ',
      }),
    ).toEqual(config);
  });

  it.each([
    [{ CF_ACCESS_TEAM_DOMAIN: 'echoandaura.cloudflareaccess.com' }],
    [{ CF_ACCESS_AUD: 'aud-admin' }],
  ])('throws on half a configuration (%o)', (env) => {
    expect(() => read(env)).toThrow(/both CF_ACCESS_TEAM_DOMAIN and CF_ACCESS_AUD/);
  });
});
