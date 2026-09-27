import { describe, expect, it } from 'vitest';
import { OFFLINE_SYNC_BATCH, doorScansSchema } from '@/lib/validation/door';

let n = 0;
const id = () => `00000000-0000-4000-a000-${String(++n).padStart(12, '0')}`;
const live = () => ({ scanId: id(), input: 'TKT-4H8ZP2XQ', method: 'qr' as const });
const off = (over: Record<string, unknown> = {}) => ({
  ...live(),
  scannedAt: '2026-10-10T14:00:00.000Z',
  offline: { verdict: 'admitted' },
  ...over,
});

describe('doorScansSchema (ADR-030, ADR-034)', () => {
  it('takes one live scan, or a batch of offline ones', () => {
    expect(doorScansSchema.safeParse({ scans: [live()] }).success).toBe(true);
    const batch = Array.from({ length: OFFLINE_SYNC_BATCH }, () => off());
    expect(doorScansSchema.safeParse({ scans: batch }).success).toBe(true);
  });

  it('refuses two live scans in one request, or a live scan riding a sync', () => {
    expect(doorScansSchema.safeParse({ scans: [live(), live()] }).success).toBe(false);
    expect(doorScansSchema.safeParse({ scans: [off(), live()] }).success).toBe(false);
  });

  it('refuses a batch over the limit', () => {
    const batch = Array.from({ length: OFFLINE_SYNC_BATCH + 1 }, () => off());
    expect(doorScansSchema.safeParse({ scans: batch }).success).toBe(false);
  });

  it('refuses an offline scan with no time, an offline name-search admit, and a self-replacing scan', () => {
    expect(doorScansSchema.safeParse({ scans: [off({ scannedAt: undefined })] }).success).toBe(
      false,
    );
    const search = off({ input: undefined, ticketId: id(), method: 'search', phoneLast3: '678' });
    expect(doorScansSchema.safeParse({ scans: [search] }).success).toBe(false);
    const self = off();
    const selfish = { ...self, offline: { verdict: 'admitted', supersedesScanId: self.scanId } };
    expect(doorScansSchema.safeParse({ scans: [selfish] }).success).toBe(false);
  });

  it('refuses an unknown verdict', () => {
    expect(
      doorScansSchema.safeParse({ scans: [off({ offline: { verdict: 'maybe' } })] }).success,
    ).toBe(false);
  });
});
