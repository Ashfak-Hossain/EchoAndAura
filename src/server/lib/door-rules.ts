/**
 * ADR-030 gate check-in limits shared by the door service, the Zod schemas
 * at the boundary and the door phone's own screen, so a number is never
 * restated differently. Pure — the /door client imports this file.
 */

/** Longest scan input accepted: an odd QR (a vCard, Wi-Fi) must never cause a 500. */
export const SCAN_INPUT_MAX = 512;

/** A door may undo its own admit this long after it (a mis-tap, the wrong person). */
export const DOOR_UNDO_WINDOW_MS = 2 * 60_000;

export const DOOR_UNDO_REASONS = {
  wrong_person: 'Wrong person',
  mis_tap: 'Tapped by mistake',
  other: 'Other',
} as const;
export type DoorUndoReason = keyof typeof DOOR_UNDO_REASONS;

/**
 * A re-read of a ticket this same gate admitted this recently is amber
 * ("admitted 20 s ago at this gate — same person?"), not a red ALREADY IN:
 * the person just let in waved their phone again.
 */
export const SAME_GATE_SECONDS = 60;
