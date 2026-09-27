import { describe, expect, it } from 'vitest';
import {
  type OfflineEntry,
  clampOfflineTime,
  judgeOffline,
  offlineDigest,
} from '@/server/lib/door-offline';

const entry = (over: Partial<OfflineEntry> = {}): OfflineEntry => ({
  d: 'x',
  id: 't-1',
  name: 'Nusrat Jahan',
  type: 'General',
  pos: 1,
  of: 2,
  status: 'issued',
  inAt: null,
  inBy: null,
  ...over,
});
const OPEN = Date.parse('2026-10-10T14:00:00Z');
const LATER = OPEN + 60 * 60_000;

describe('offlineDigest', () => {
  it('is the same for the same salt and code, 32 hex, and changes with either', async () => {
    const a = await offlineDigest('s1', 'TKT-4H8ZP2XQ');
    expect(a).toMatch(/^[0-9a-f]{32}$/);
    expect(await offlineDigest('s1', 'TKT-4H8ZP2XQ')).toBe(a);
    expect(await offlineDigest('s2', 'TKT-4H8ZP2XQ')).not.toBe(a);
    expect(await offlineDigest('s1', 'TKT-4H8ZP2XR')).not.toBe(a);
  });

  it('matches a known SHA-256 prefix, so phone and server can never drift', async () => {
    // sha256("s:TKT-AAAAAAAA"), first 32 hex characters.
    const { createHash } = await import('node:crypto');
    const expected = createHash('sha256').update('s:TKT-AAAAAAAA').digest('hex').slice(0, 32);
    expect(await offlineDigest('s', 'TKT-AAAAAAAA')).toBe(expected);
  });
});

describe('judgeOffline', () => {
  const judge = (
    e: OfflineEntry | null,
    local: { at: string; gate: string; byThisPhone: boolean } | null = null,
    now = LATER,
  ) => judgeOffline({ entry: e, localAdmit: local, now, validFrom: OPEN });

  it('admits a valid ticket nobody has used', () => {
    expect(judge(entry())).toMatchObject({
      result: 'admitted',
      verdict: 'admitted',
      practice: false,
    });
  });

  it('refuses a read that is not on the list (another event looks the same offline)', () => {
    expect(judge(null)).toMatchObject({ result: 'unknown', verdict: 'refused' });
  });

  it('refuses a cancelled ticket', () => {
    expect(judge(entry({ status: 'cancelled' }))).toMatchObject({
      result: 'cancelled',
      verdict: 'refused',
    });
  });

  it('refuses a ticket the list says is in, with when and where', () => {
    expect(judge(entry({ inAt: '2026-10-10T14:20:00.000Z', inBy: 'Gate A' }))).toMatchObject({
      result: 'already_in',
      verdict: 'refused',
      gate: 'Gate A',
      byThisPhone: false,
    });
  });

  it('refuses a ticket this phone admitted since the list was built', () => {
    const local = { at: '2026-10-10T14:30:00.000Z', gate: 'Gate B', byThisPhone: true };
    expect(judge(entry(), local)).toMatchObject({
      result: 'already_in',
      verdict: 'refused',
      at: local.at,
      byThisPhone: true,
    });
  });

  it('answers practice before doors open, and never admits', () => {
    expect(judge(entry(), null, OPEN - 1)).toMatchObject({
      result: 'practice_ok',
      verdict: 'practice',
      practice: true,
    });
    expect(judge(null, null, OPEN - 1)).toMatchObject({ result: 'unknown', verdict: 'practice' });
    expect(judge(entry({ inAt: '2026-10-10T13:00:00.000Z' }), null, OPEN - 1).verdict).toBe(
      'practice',
    );
  });
});

describe('clampOfflineTime', () => {
  const from = new Date(OPEN);
  const now = new Date(LATER);
  it('keeps a time inside the window', () => {
    const t = new Date(OPEN + 1000);
    expect(clampOfflineTime(t, from, now)).toEqual(t);
  });
  it('never before doors opened, never in the future', () => {
    expect(clampOfflineTime(new Date(OPEN - 99_999), from, now)).toEqual(from);
    expect(clampOfflineTime(new Date(LATER + 99_999), from, now)).toEqual(now);
  });
});
