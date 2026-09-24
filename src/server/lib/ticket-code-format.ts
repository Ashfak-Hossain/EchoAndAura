/**
 * The shape of a ticket code, `TKT-4H8ZP2XQ` — pure, no `node:crypto`, so
 * the door phone can parse a scan exactly the way the server does
 * (ADR-030). Generation lives in `ticket-code.ts`.
 */
export const TICKET_CODE_PREFIX = 'TKT-';
export const TICKET_CODE_LENGTH = 8;
export const TICKET_CODE_PATTERN = /^TKT-[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{8}$/;
