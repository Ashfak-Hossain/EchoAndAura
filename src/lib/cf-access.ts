import { createRemoteJWKSet, jwtVerify, type JWTVerifyGetKey } from 'jose';

/**
 * ADR-050: Cloudflare Access stands in front of /admin. Cloudflare checks
 * the visitor's email at its edge, then attaches a signed token
 * (`Cf-Access-Jwt-Assertion`, also the `CF_Authorization` cookie) to every
 * request it lets through.
 *
 * The origin checks that token too. Origin lockdown (ADR-045) admits only
 * Cloudflare's addresses, but those are shared by every Cloudflare
 * customer: a Worker on someone else's account can reach this server with
 * `Host: echoandaura.com` and never pass our Access policy. Only a token
 * signed for our team and our application proves the request went
 * through it.
 */

export const ACCESS_JWT_HEADER = 'cf-access-jwt-assertion';
export const ACCESS_JWT_COOKIE = 'CF_Authorization';

export interface AccessConfig {
  /** `echoandaura.cloudflareaccess.com` — the issuer and the keys' home. */
  teamDomain: string;
  /** The Admin application's Audience (AUD) tag. */
  aud: string;
}

/**
 * Null while Access is not set up (local dev, the e2e suite, and the
 * rollout before the Admin app exists): the check is off. Half a
 * configuration throws, so a typo can't quietly switch it off.
 */
export function readAccessConfig(env: NodeJS.ProcessEnv = process.env): AccessConfig | null {
  const teamDomain = env.CF_ACCESS_TEAM_DOMAIN?.trim()
    .replace(/^https?:\/\//, '')
    .replace(/\/+$/, '');
  const aud = env.CF_ACCESS_AUD?.trim();
  if (!teamDomain && !aud) return null;
  if (!teamDomain || !aud) {
    throw new Error(
      'Set both CF_ACCESS_TEAM_DOMAIN and CF_ACCESS_AUD, or neither — see docs/ENVIRONMENT.md § Cloudflare Access',
    );
  }
  return { teamDomain, aud };
}

export interface AccessVerifier {
  /** True when the token was signed by our team's keys, for our app, and is still valid. */
  verify(token: string | null | undefined): Promise<boolean>;
}

export function createAccessVerifier(
  config: AccessConfig,
  // Injectable for tests; production fetches (and caches) Cloudflare's keys.
  keys: JWTVerifyGetKey = createRemoteJWKSet(
    new URL(`https://${config.teamDomain}/cdn-cgi/access/certs`),
  ),
): AccessVerifier {
  return {
    async verify(token) {
      if (!token) return false;
      try {
        await jwtVerify(token, keys, {
          issuer: `https://${config.teamDomain}`,
          audience: config.aud,
          algorithms: ['RS256'],
        });
        return true;
      } catch {
        return false;
      }
    },
  };
}
