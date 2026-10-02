import { z } from 'zod';
import { TURNSTILE_TOKEN_MAX, type TurnstileAction } from '@/lib/turnstile-config';
import { logger } from './logger';

/**
 * ADR-048: the server half of Turnstile. The browser's widget solves a
 * challenge and puts a token in the form; this asks Cloudflare whether
 * that token is genuine, unspent, solved on our host, for this form.
 *
 * It runs in the server action before any service call, so it is never
 * inside a database transaction (Invariant 7).
 */

export const SITEVERIFY_URL = 'https://challenges.cloudflare.com/turnstile/v0/siteverify';

export type TurnstileVerdict =
  /** `degraded`: Cloudflare could not answer, so we let it through (see below). */
  | { ok: true; degraded: boolean }
  | {
      ok: false;
      reason: 'missing' | 'rejected' | 'action-mismatch' | 'hostname-mismatch' | 'misconfigured';
    };

export interface TurnstileVerifier {
  verify(
    token: unknown,
    ctx: { action: TurnstileAction; ip: string | null },
  ): Promise<TurnstileVerdict>;
}

export interface TurnstileVerifierDeps {
  secretKey: string;
  /**
   * Null means test keys: their answers carry neither our host nor the
   * form's action, so both claims are skipped.
   */
  expectedHostname: string | null;
  fetch?: typeof fetch;
  timeoutMs?: number;
  /** Lets Cloudflare recognise a retried request; injectable for tests. */
  idempotencyKey?: () => string;
}

const siteverifyResponse = z.object({
  success: z.boolean(),
  'error-codes': z.array(z.string()).optional().default([]),
  hostname: z.string().optional(),
  action: z.string().optional(),
});

/** Our secret is wrong: every visitor would be refused, so it is an error, not a bot. */
const SECRET_ERRORS = new Set(['missing-input-secret', 'invalid-input-secret']);

const IPV4_OR_6 = /^[0-9a-f:.]+$/i;

export function createTurnstileVerifier(deps: TurnstileVerifierDeps): TurnstileVerifier {
  const doFetch = deps.fetch ?? fetch;
  const timeoutMs = deps.timeoutMs ?? 3000;
  const newKey = deps.idempotencyKey ?? (() => crypto.randomUUID());

  return {
    async verify(token, { action, ip }) {
      // No network call for something that can't be a token.
      if (typeof token !== 'string' || token.length === 0 || token.length > TURNSTILE_TOKEN_MAX) {
        return { ok: false, reason: 'missing' };
      }

      const body = new URLSearchParams({
        secret: deps.secretKey,
        response: token,
        idempotency_key: newKey(),
      });
      // Only a real address helps Cloudflare; locally requestIp() says "unknown".
      if (ip && IPV4_OR_6.test(ip)) body.set('remoteip', ip);

      let raw: unknown;
      try {
        const res = await doFetch(SITEVERIFY_URL, {
          method: 'POST',
          body,
          signal: AbortSignal.timeout(timeoutMs),
        });
        if (res.status >= 500) throw new Error(`siteverify answered ${res.status}`);
        raw = await res.json();
      } catch (err: unknown) {
        // Fail open on an outage. The site itself is served through
        // Cloudflare, so this is rare and short; the rate limits and the
        // per-phone order cap (ADR-046) still hold. Refusing would close
        // registration for everyone because of a third party.
        logger.warn(
          { action, err: err instanceof Error ? err.message : err },
          'turnstile siteverify unavailable — allowing',
        );
        return { ok: true, degraded: true };
      }

      const parsed = siteverifyResponse.safeParse(raw);
      if (!parsed.success) {
        logger.warn({ action }, 'turnstile siteverify answered in an unknown shape — allowing');
        return { ok: true, degraded: true };
      }
      const r = parsed.data;

      if (!r.success) {
        const codes = r['error-codes'];
        if (codes.some((c) => SECRET_ERRORS.has(c))) {
          // Fail closed, loudly: allowing would switch the bot check off
          // without anyone noticing. The deploy checklist submits a form.
          logger.error({ action, codes }, 'turnstile secret rejected by Cloudflare — refusing');
          return { ok: false, reason: 'misconfigured' };
        }
        if (codes.includes('internal-error')) {
          logger.warn({ action, codes }, 'turnstile siteverify internal error — allowing');
          return { ok: true, degraded: true };
        }
        return { ok: false, reason: 'rejected' };
      }
      if (deps.expectedHostname !== null) {
        if (r.action !== action) return { ok: false, reason: 'action-mismatch' };
        if (r.hostname !== deps.expectedHostname) return { ok: false, reason: 'hostname-mismatch' };
      }
      return { ok: true, degraded: false };
    },
  };
}
