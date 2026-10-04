/** Queue and job names shared by producers (app) and the worker. */
export const ORDERS_QUEUE = 'orders';

/**
 * Repeating job: expire lapsed holds (ADR-054, ADR-012). On a queue of its
 * own, with its own worker: on the shared queue it waited behind emails
 * (a 5/s limiter) — after an on-sale rush, the very emails its own
 * expiries queue — and seats came back late.
 */
export const HOLDS_QUEUE = 'holds';
export const EXPIRE_HOLDS_JOB = 'expire-holds';
export const EXPIRE_HOLDS_EVERY_MS = 60_000;

/** Repeating job on the orders queue: the email worker's heartbeat (ADR-054). */
export const WORKER_PING_JOB = 'worker.ping';

/** Email jobs: `email.<kind>` with payload `{ orderId }` (see email/dispatch.ts). */
export const EMAIL_JOB_PREFIX = 'email.';

/** Magic-link sign-in email: payload `{ to, url }`. Not under `email.` — it has no order. */
export const SIGN_IN_JOB = 'auth.sign-in';

/** Admin account emails (ADR-038): payload `AccountEmail` (reset, confirm new address, change notice). */
export const ACCOUNT_EMAIL_JOB = 'auth.account';

/**
 * ADR-058: announcements to the gate relay, after a door commit. A queue of
 * its own, worked one job at a time (so they arrive in order) with no
 * limiter: nothing may wait behind emails.
 */
export const RELAY_QUEUE = 'relay';
export const RELAY_ANNOUNCE_JOB = 'relay.announce';
