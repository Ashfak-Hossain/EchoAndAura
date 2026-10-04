/**
 * ADR-058: the relay pass — what lets a door phone (or our server) into an
 * event's room on the Cloudflare relay. The relay checks it with the shared
 * secret alone, never by asking our server: that is what keeps gates
 * sharing check-ins while the server is down.
 *
 * `base64url(JSON claims) . base64url(HMAC-SHA256)`. Pure WebCrypto (no
 * node:*, no next/*), so the relay Worker bundles this same file.
 */

export type RelayRole = 'gate' | 'server';

export interface RelayClaims {
  v: 1;
  /** `gate`: a door phone in the room; `server`: our server announcing to it. */
  role: RelayRole;
  eventId: string;
  /** The gate pass (role `gate`): what a revoke closes. */
  passId?: string;
  /** The gate's name (role `gate`): what other gates are told. */
  gate?: string;
  /** Expiry, unix seconds. */
  exp: number;
}

/** The secret both sides hold: long enough that guessing is not a plan. */
export const RELAY_SECRET_MIN_LENGTH = 32;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
/** A gate name is a pass label: short text, shown on other gates' screens. */
const GATE_MAX = 60;

function toBase64Url(bytes: Uint8Array): string {
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromBase64Url(text: string): Uint8Array<ArrayBuffer> | null {
  if (!/^[A-Za-z0-9_-]*$/.test(text)) return null;
  try {
    const bin = atob(text.replace(/-/g, '+').replace(/_/g, '/'));
    return Uint8Array.from(bin, (c) => c.charCodeAt(0));
  } catch {
    return null;
  }
}

async function hmacKey(secret: string): Promise<CryptoKey> {
  if (secret.length < RELAY_SECRET_MIN_LENGTH) {
    throw new Error(`relay secret must be at least ${RELAY_SECRET_MIN_LENGTH} characters`);
  }
  return crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign', 'verify'],
  );
}

function validClaims(value: unknown): value is RelayClaims {
  if (typeof value !== 'object' || value === null) return false;
  const c = value as Record<string, unknown>;
  if (c.v !== 1 || (c.role !== 'gate' && c.role !== 'server')) return false;
  if (typeof c.eventId !== 'string' || !UUID.test(c.eventId)) return false;
  if (typeof c.exp !== 'number' || !Number.isInteger(c.exp)) return false;
  if (c.role === 'gate') {
    if (typeof c.passId !== 'string' || !UUID.test(c.passId)) return false;
    if (typeof c.gate !== 'string' || c.gate.length === 0 || c.gate.length > GATE_MAX) return false;
  }
  return true;
}

export async function signRelayPass(claims: RelayClaims, secret: string): Promise<string> {
  if (!validClaims(claims)) throw new Error('relay pass: invalid claims');
  const body = toBase64Url(new TextEncoder().encode(JSON.stringify(claims)));
  const sig = await crypto.subtle.sign(
    'HMAC',
    await hmacKey(secret),
    new TextEncoder().encode(body),
  );
  return `${body}.${toBase64Url(new Uint8Array(sig))}`;
}

/**
 * The claims, or null for anything else: a bad shape, a wrong signature,
 * an expired pass. The signature is checked by WebCrypto (constant time)
 * before the claims are even parsed.
 */
export async function verifyRelayPass(
  token: string,
  secret: string,
  nowMs: number,
): Promise<RelayClaims | null> {
  const [body, sig, extra] = token.split('.');
  if (!body || !sig || extra !== undefined) return null;
  const sigBytes = fromBase64Url(sig);
  const bodyBytes = fromBase64Url(body);
  if (!sigBytes || !bodyBytes) return null;
  const ok = await crypto.subtle.verify(
    'HMAC',
    await hmacKey(secret),
    sigBytes,
    new TextEncoder().encode(body),
  );
  if (!ok) return null;
  let claims: unknown;
  try {
    claims = JSON.parse(new TextDecoder().decode(bodyBytes));
  } catch {
    return null;
  }
  if (!validClaims(claims)) return null;
  return claims.exp * 1000 > nowMs ? claims : null;
}
