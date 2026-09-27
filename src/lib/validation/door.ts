import { z } from 'zod';
import { DOOR_UNDO_REASONS, type DoorUndoReason, SCAN_INPUT_MAX } from '@/server/lib/door-rules';

/**
 * ADR-030 door API and gate-pass forms. Scan input is capped generously
 * (an odd QR must never cause a 500 — the service logs it as unknown).
 * A live scan is one per request, so the per-request rate limit is a
 * per-scan limit; only an offline sync (ADR-034) sends a batch, and every
 * scan in it must be an offline one.
 */

/** Most offline scans one sync request carries; the phone sends more in turns. */
export const OFFLINE_SYNC_BATCH = 50;

export const doorSessionSchema = z.object({
  code: z.string().trim().min(1).max(40),
});

const scanItem = z
  .object({
    scanId: z.uuid(),
    input: z.string().max(SCAN_INPUT_MAX).optional(),
    ticketId: z.uuid().optional(),
    phoneLast3: z
      .string()
      .regex(/^\d{3}$/)
      .optional(),
    method: z.enum(['qr', 'typed', 'search']),
    scannedAt: z.iso.datetime().optional(),
    offline: z
      .object({
        verdict: z.enum(['admitted', 'refused', 'practice', 'undone']),
        supersedesScanId: z.uuid().optional(),
      })
      .optional(),
  })
  .refine((s) => (s.input === undefined) !== (s.ticketId === undefined), {
    message: 'A scan carries either input or a ticket id.',
  })
  .refine((s) => (s.method === 'search') === (s.ticketId !== undefined), {
    message: 'Only a search admit carries a ticket id.',
  })
  .refine((s) => s.phoneLast3 === undefined || s.method === 'search', {
    message: 'Only a search admit carries phone digits.',
  })
  // The phone digits are checked only on the server: offline, a name
  // search cannot admit (ADR-034).
  .refine((s) => s.offline === undefined || s.method !== 'search', {
    message: 'A name-search admit needs signal.',
  })
  .refine((s) => s.offline === undefined || s.scannedAt !== undefined, {
    message: 'An offline scan carries the time it was made.',
  })
  .refine((s) => s.offline?.supersedesScanId !== s.scanId, {
    message: 'A scan cannot replace itself.',
  })
  .transform((s) => ({ ...s, scannedAt: s.scannedAt ? new Date(s.scannedAt) : undefined }));

export const doorScansSchema = z
  .object({
    scans: z.array(scanItem).min(1).max(OFFLINE_SYNC_BATCH),
  })
  .refine((b) => b.scans.length === 1 || b.scans.every((s) => s.offline !== undefined), {
    message: 'Only an offline sync sends more than one scan.',
  });

export const doorSearchSchema = z.object({
  q: z.string().max(80),
});

const undoReasons = Object.keys(DOOR_UNDO_REASONS) as [DoorUndoReason, ...DoorUndoReason[]];
export const doorUndoSchema = z.object({
  scanId: z.uuid(),
  reason: z.enum(undoReasons),
});

export const gatePassFormSchema = z.object({
  label: z
    .string({ error: 'Name the gate, e.g. Gate A.' })
    .trim()
    .min(1, { error: 'Name the gate, e.g. Gate A.' })
    .max(40, { error: 'Keep the gate name under 40 characters.' }),
});

export const CHECK_IN_UNDO_REASON_MAX = 200;
export const checkInUndoFormSchema = z.object({
  reason: z
    .string()
    .trim()
    .min(2, { error: 'Say why — it goes in the audit trail.' })
    .max(CHECK_IN_UNDO_REASON_MAX, {
      error: `Keep the reason under ${CHECK_IN_UNDO_REASON_MAX} characters.`,
    }),
});
