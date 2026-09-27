import { randomInt } from 'node:crypto';
import { ORDER_REFERENCE_ALPHABET } from '@/server/lib/order-reference';
import { TICKET_CODE_LENGTH, TICKET_CODE_PREFIX } from './ticket-code-format';

/**
 * Public ticket code, e.g. `TKT-4H8ZP2XQ`: read out at the door, printed on
 * the check-in list, and the key of the web ticket page. Same unambiguous
 * alphabet as order references; eight characters (~850 billion values)
 * because the code IS the access key for the ticket page. UNIQUE in the
 * database; the fulfilment service retries the whole transaction on the
 * (astronomically rare) collision.
 */
export { TICKET_CODE_LENGTH, TICKET_CODE_PATTERN, TICKET_CODE_PREFIX } from './ticket-code-format';

export function generateTicketCode(random: (max: number) => number = randomInt): string {
  let body = '';
  for (let i = 0; i < TICKET_CODE_LENGTH; i++) {
    body += ORDER_REFERENCE_ALPHABET[random(ORDER_REFERENCE_ALPHABET.length)];
  }
  return TICKET_CODE_PREFIX + body;
}
