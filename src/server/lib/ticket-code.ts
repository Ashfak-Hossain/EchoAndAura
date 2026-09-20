import { randomInt } from 'node:crypto';
import { ORDER_REFERENCE_ALPHABET } from '@/server/lib/order-reference';

/**
 * Public ticket code, e.g. `TKT-4H8ZP2XQ`: read out at the door, printed on
 * the check-in list, and the key of the web ticket page. Same unambiguous
 * alphabet as order references; eight characters (~850 billion values)
 * because the code IS the access key for the ticket page. UNIQUE in the
 * database; the fulfilment service retries the whole transaction on the
 * (astronomically rare) collision.
 */
export const TICKET_CODE_PREFIX = 'TKT-';
export const TICKET_CODE_LENGTH = 8;
export const TICKET_CODE_PATTERN = /^TKT-[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{8}$/;

export function generateTicketCode(random: (max: number) => number = randomInt): string {
  let body = '';
  for (let i = 0; i < TICKET_CODE_LENGTH; i++) {
    body += ORDER_REFERENCE_ALPHABET[random(ORDER_REFERENCE_ALPHABET.length)];
  }
  return TICKET_CODE_PREFIX + body;
}
