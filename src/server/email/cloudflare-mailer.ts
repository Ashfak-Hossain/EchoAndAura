import { randomUUID } from 'node:crypto';
import {
  type Mailer,
  type MailerEnv,
  MailerPermanentError,
  MailerThrottledError,
  type OutgoingEmail,
} from './mailer';

/**
 * Cloudflare Email Service adapter (ADR-057): the worker POSTs JSON to the
 * REST API from the VPS; no Workers code is involved. Replaces SES, whose
 * production access was refused twice (SES stays as a `MAILER=ses`
 * rollback).
 *
 * The API returns per-recipient delivery status, not a message id, and
 * Cloudflare sets the `Message-ID` header itself. So each send gets our own
 * id, carried in an `X-Echoandaura-Id` header: the id in the order's audit
 * note and the worker log is the one in Gmail's "Show original".
 */
export interface CloudflareEmailEnv {
  accountId: string;
  apiToken: string;
}

/** A Cloudflare account id: 32 hex characters. */
const ACCOUNT_ID = /^[0-9a-f]{32}$/;
/** An API token: 40+ URL-safe characters, no spaces. */
const API_TOKEN = /^[A-Za-z0-9_-]{40,}$/;

export function readCloudflareEmailEnv(env: NodeJS.ProcessEnv = process.env): CloudflareEmailEnv {
  const accountId = env.CLOUDFLARE_ACCOUNT_ID?.trim();
  const apiToken = env.CLOUDFLARE_EMAIL_API_TOKEN?.trim();
  if (!accountId || !apiToken) {
    throw new Error(
      'CLOUDFLARE_ACCOUNT_ID / CLOUDFLARE_EMAIL_API_TOKEN are not set — see docs/ENVIRONMENT.md § Email',
    );
  }
  // Shape-checked at boot, like the SES keys: a placeholder must stop the
  // worker, not fail every send. The message never contains the value.
  if (!ACCOUNT_ID.test(accountId)) {
    throw new Error(
      `CLOUDFLARE_ACCOUNT_ID does not look like an account id (32 hex characters; got ${accountId.length}) — copy it from the dashboard's account home`,
    );
  }
  if (!API_TOKEN.test(apiToken)) {
    throw new Error(
      `CLOUDFLARE_EMAIL_API_TOKEN does not look like an API token (40+ characters, no spaces; got ${apiToken.length}) — a placeholder left in the environment?`,
    );
  }
  return { accountId, apiToken };
}

/** `echoandaura <tickets@echoandaura.com>` → the API's named-address object. */
export function parseAddress(raw: string): string | { address: string; name: string } {
  const named = raw.match(/^\s*"?([^"<]*?)"?\s*<([^>]+)>\s*$/);
  if (!named) return raw.trim();
  const [, name, address] = named;
  return name ? { address: address!.trim(), name } : address!.trim();
}

/**
 * Error codes that say the request itself is wrong: retrying the same JSON
 * can never succeed. Token, permission and account problems (401/403/404)
 * are NOT here: they are fixed in Dokploy, and the email should still go out
 * once they are, so they stay retryable (five attempts over ~7.5 minutes).
 */
const PERMANENT_CODES = new Set([10001, 10200, 10201, 10202]);
const THROTTLED_CODE = 10004;

interface ApiResponse {
  success?: boolean;
  errors?: { code?: number; message?: string }[];
  result?: { delivered?: string[]; permanent_bounces?: string[]; queued?: string[] } | null;
}

export type Fetch = (url: string, init: RequestInit) => Promise<Response>;

const TIMEOUT_MS = 20_000;

export function createCloudflareMailer(
  env: MailerEnv,
  cf: CloudflareEmailEnv,
  fetchImpl: Fetch = fetch,
): Mailer {
  const url = `https://api.cloudflare.com/client/v4/accounts/${cf.accountId}/email/sending/send`;

  return {
    async send(message: OutgoingEmail) {
      const id = randomUUID();
      const body = {
        from: parseAddress(env.from),
        to: message.to,
        ...(env.replyTo ? { reply_to: env.replyTo } : {}),
        subject: message.subject,
        html: message.html,
        text: message.text,
        headers: { 'X-Echoandaura-Id': id },
        ...(message.attachments?.length
          ? {
              attachments: message.attachments.map((a) => ({
                content: a.content.toString('base64'),
                filename: a.filename,
                type: a.contentType,
                disposition: 'attachment',
              })),
            }
          : {}),
      };

      // A network failure or timeout throws here and is retried as-is.
      const res = await fetchImpl(url, {
        method: 'POST',
        headers: { Authorization: `Bearer ${cf.apiToken}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
      const json = (await res.json().catch(() => ({}))) as ApiResponse;
      const codes = (json.errors ?? []).map((e) => e.code);
      const detail = (json.errors ?? []).map((e) => `${e.code} ${e.message}`).join('; ');

      if (res.status === 429 || codes.includes(THROTTLED_CODE)) {
        throw new MailerThrottledError(`Cloudflare Email ${res.status}: ${detail}`);
      }
      if (!res.ok || json.success !== true) {
        const reason = `Cloudflare Email ${res.status}: ${detail || 'no error detail'}`;
        if (codes.some((c) => c !== undefined && PERMANENT_CODES.has(c))) {
          throw new MailerPermanentError(reason);
        }
        throw new Error(reason);
      }

      const result = json.result ?? {};
      if (result.permanent_bounces?.length) {
        throw new MailerPermanentError(`Cloudflare Email: ${message.to} bounced permanently`);
      }
      // "queued" is accepted for later delivery: a success, recorded as such.
      return { messageId: result.queued?.length ? `${id} (queued)` : id };
    },
  };
}
