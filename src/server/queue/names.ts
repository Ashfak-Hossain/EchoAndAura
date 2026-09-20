/** Queue and job names shared by producers (app) and the worker. */
export const ORDERS_QUEUE = 'orders';

/** Repeating job: expire lapsed 24h holds (ADR-002, ADR-012). */
export const EXPIRE_HOLDS_JOB = 'expire-holds';
export const EXPIRE_HOLDS_EVERY_MS = 60_000;

/** Email jobs: `email.<kind>` with payload `{ orderId }` (see email/dispatch.ts). */
export const EMAIL_JOB_PREFIX = 'email.';

/** Magic-link sign-in email: payload `{ to, url }`. Not under `email.` — it has no order. */
export const SIGN_IN_JOB = 'auth.sign-in';
