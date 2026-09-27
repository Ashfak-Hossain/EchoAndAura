import { describe, expect, it } from 'vitest';
import { MARK_GRACE_MS, listCovers, localUndo } from '@/app/door/offline/rules';

const T = Date.parse('2026-10-10T15:00:00Z');

describe('listCovers (ADR-034 phone marks)', () => {
  it('never drops a mark the server has not confirmed, however old the admit', () => {
    expect(listCovers(null, T + 60 * 60_000)).toBe(false);
  });

  it('keeps a mark whose sync landed after (or just before) the list was read', () => {
    // The list read began before the sync landed: it cannot know.
    expect(listCovers(T, T - 1_000)).toBe(false);
    // Within the clock-correction grace: kept, to be safe.
    expect(listCovers(T, T + MARK_GRACE_MS)).toBe(false);
  });

  it('drops it once a list read well after the server had it', () => {
    expect(listCovers(T, T + MARK_GRACE_MS + 1)).toBe(true);
  });
});

describe('localUndo (ADR-034)', () => {
  const at = new Date(T).toISOString();
  it('undoes an offline admit that never left the phone, within 2 minutes', () => {
    expect(localUndo({ verdict: 'admitted', scannedAt: at }, T + 60_000, false)).toBe('done');
  });

  it('refuses once the scan was sent — even unanswered — or is being sent', () => {
    expect(
      localUndo({ verdict: 'admitted', scannedAt: at, attempted: true }, T + 1_000, false),
    ).toBe('sent');
    expect(localUndo({ verdict: 'admitted', scannedAt: at }, T + 1_000, true)).toBe('sent');
  });

  it('refuses a late undo, a scan that was not an admit, and a missing one', () => {
    expect(localUndo({ verdict: 'admitted', scannedAt: at }, T + 3 * 60_000, false)).toBe(
      'not_found',
    );
    expect(localUndo({ verdict: 'refused', scannedAt: at }, T, false)).toBe('not_found');
    expect(localUndo(undefined, T, false)).toBe('not_found');
  });
});
