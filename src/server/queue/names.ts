/** Queue and job names shared by producers (app) and the worker. */
export const ORDERS_QUEUE = 'orders';

/** Repeating job: expire lapsed 24h holds (ADR-002, ADR-012). */
export const EXPIRE_HOLDS_JOB = 'expire-holds';
export const EXPIRE_HOLDS_EVERY_MS = 60_000;
