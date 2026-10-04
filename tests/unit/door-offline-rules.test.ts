import { describe, expect, it } from 'vitest';
import {
  MARK_GRACE_MS,
  type Mark,
  type RelayRow,
  listCovers,
  localUndo,
  markFromRelay,
  relayUndoRemoves,
  UNDO_SLACK_MS,
  unconfirmedOwnClaims,
} from '@/app/door/offline/rules';

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

describe('relay marks (ADR-058)', () => {
  const T = 'a1a1a1a1-1111-4111-8111-111111111111';
  const AT = '2026-10-10T18:00:00.000Z';
  const atMs = Date.parse(AT);
  const NOW_MS = atMs + 5_000;
  const row = (over: Partial<RelayRow> = {}): RelayRow => ({
    ticketId: T,
    at: AT,
    gate: 'Gate B',
    confirmed: false,
    seq: 1,
    ...over,
  });
  const mark = (over: Partial<Mark> = {}): Mark => ({
    at: atMs,
    gate: 'Gate B',
    byThisPhone: false,
    knownSince: NOW_MS,
    source: 'server',
    ...over,
  });

  describe('markFromRelay', () => {
    it("keeps another gate's claim as unconfirmed, so no list download drops it (S1)", () => {
      const m = markFromRelay(undefined, row(), NOW_MS);
      expect(m).toEqual({
        at: atMs,
        gate: 'Gate B',
        byThisPhone: false,
        knownSince: null,
        source: 'relay',
      });
      expect(listCovers(m!.knownSince, NOW_MS + 3_600_000)).toBe(false);
    });

    it("turns the claim into the server's word when the relay confirms it", () => {
      const claim = markFromRelay(undefined, row(), NOW_MS)!;
      const confirmed = markFromRelay(claim, row({ confirmed: true, seq: 2 }), NOW_MS + 1);
      expect(confirmed).toMatchObject({ knownSince: NOW_MS + 1, source: 'relay' });
    });

    it("never touches this phone's own mark or the server's", () => {
      expect(markFromRelay(mark({ source: 'own', knownSince: null }), row(), NOW_MS)).toBeNull();
      expect(
        markFromRelay(mark({ source: 'server' }), row({ confirmed: true }), NOW_MS),
      ).toBeNull();
    });

    it('ignores a row with no usable time', () => {
      expect(markFromRelay(undefined, row({ at: 'soon' }), NOW_MS)).toBeNull();
    });
  });

  describe('relayUndoRemoves (B1, S4, S-B)', () => {
    const claim = mark({ source: 'relay', knownSince: null });
    const gate = { by: 'gate' as const, at: AT };
    const server = (ms: number) => ({ by: 'server' as const, at: new Date(ms).toISOString() });

    it("a gate's undo removes only that unconfirmed claim", () => {
      expect(relayUndoRemoves(claim, gate)).toBe(true);
      // What the server or the ping vouched for stays: a stolen pass cannot sweep it.
      expect(relayUndoRemoves(mark({ source: 'server' }), gate)).toBe(false);
      expect(relayUndoRemoves(mark({ source: 'relay' }), gate)).toBe(false);
      expect(relayUndoRemoves(undefined, gate)).toBe(false);
    });

    it("the server's undo removes the check-in it undid — never a re-admit", () => {
      expect(relayUndoRemoves(mark(), server(atMs))).toBe(true);
      expect(relayUndoRemoves(mark(), server(atMs - 60_000))).toBe(false);
      expect(relayUndoRemoves(mark(), { by: 'server', at: 'soon' })).toBe(false);
    });

    it("the server's undo removes a claim from before it — not a newer one (a retried undo)", () => {
      expect(relayUndoRemoves(claim, server(atMs))).toBe(true);
      expect(relayUndoRemoves(claim, server(atMs - UNDO_SLACK_MS))).toBe(true);
      expect(relayUndoRemoves(claim, server(atMs - UNDO_SLACK_MS - 1))).toBe(false);
      expect(relayUndoRemoves(claim, server(atMs - 3_600_000))).toBe(false);
    });

    it("never removes this phone's own admit the server has not had yet", () => {
      const own = mark({ source: 'own', byThisPhone: true, knownSince: null });
      expect(relayUndoRemoves(own, server(atMs))).toBe(false);
      expect(relayUndoRemoves(own, gate)).toBe(false);
    });
  });

  describe('unconfirmedOwnClaims (S3)', () => {
    it('re-sends own admits the server lacks, and local undos still waiting', () => {
      const U = 'b2b2b2b2-2222-4222-8222-222222222222';
      const marks = new Map<string, Mark>([
        [T, mark({ source: 'own', byThisPhone: true, knownSince: null })],
        ['c3c3c3c3-3333-4333-8333-333333333333', mark({ source: 'own', byThisPhone: true })],
        ['d4d4d4d4-4444-4444-8444-444444444444', mark({ source: 'relay', knownSince: null })],
      ]);
      expect(
        unconfirmedOwnClaims(marks, [
          { verdict: 'undone', ticketId: U },
          { verdict: 'admitted', ticketId: T },
        ]),
      ).toEqual([
        { t: 'in', ticketId: T, at: atMs },
        { t: 'undo', ticketId: U },
      ]);
    });
  });
});
