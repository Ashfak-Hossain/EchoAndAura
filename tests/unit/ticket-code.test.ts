import { describe, expect, it } from 'vitest';
import { TICKET_CODE_PATTERN, generateTicketCode } from '@/server/lib/ticket-code';
import {
  REJECTION_NOTE_MAX,
  REJECTION_REASONS,
  REJECTION_REASON_CODES,
  isRejectionReason,
} from '@/server/lib/rejection-reasons';

describe('generateTicketCode', () => {
  it('is TKT- plus eight unambiguous characters, deterministic under an injected RNG', () => {
    for (let i = 0; i < 100; i++) expect(generateTicketCode()).toMatch(TICKET_CODE_PATTERN);
    expect(generateTicketCode(() => 0)).toBe('TKT-AAAAAAAA');
    expect(generateTicketCode()).not.toBe(generateTicketCode());
  });
});

describe('rejection reasons', () => {
  it('is a fixed list with buyer-facing labels', () => {
    expect(REJECTION_REASON_CODES).toHaveLength(6);
    for (const code of REJECTION_REASON_CODES)
      expect(REJECTION_REASONS[code].length).toBeGreaterThan(10);
    expect(isRejectionReason('no_matching_credit')).toBe(true);
    expect(isRejectionReason('because')).toBe(false);
    expect(isRejectionReason('constructor')).toBe(false); // prototype keys are not reasons
    expect(isRejectionReason(undefined)).toBe(false);
    expect(REJECTION_NOTE_MAX).toBe(500);
  });
});
