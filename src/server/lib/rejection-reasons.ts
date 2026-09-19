/**
 * Why an admin rejected a payment (B8 reject dialog). A fixed list so the
 * buyer's email and order page can be written for Raj, and so reports can
 * count them. Labels are the buyer-facing wording from the design.
 */
export const REJECTION_REASONS = {
  no_matching_credit: 'No matching credit in the bKash statement',
  amount_mismatch: 'The amount sent does not match the order total',
  trx_id_already_used: 'This transaction ID belongs to another payment',
  sender_mismatch: 'The sending number does not match the statement',
  duplicate_order: 'Duplicate of another order',
  buyer_cancelled: 'Cancelled at the buyer’s request',
} as const;

export type RejectionReason = keyof typeof REJECTION_REASONS;

export const REJECTION_REASON_CODES = Object.keys(REJECTION_REASONS) as RejectionReason[];

export function isRejectionReason(value: unknown): value is RejectionReason {
  return typeof value === 'string' && Object.hasOwn(REJECTION_REASONS, value);
}

/** Note max length (B8 textarea); the buyer sees it word for word. */
export const REJECTION_NOTE_MAX = 500;
