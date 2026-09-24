import { randomInt } from 'node:crypto';
import { addHours } from 'date-fns';
import { ORDER_REFERENCE_ALPHABET } from './order-reference';

/**
 * ADR-030 gate passes — pure rules. A pass code is 12 symbols of the
 * unambiguous alphabet (~59 bits): long enough that guessing is not a
 * practical attack, so the throttle in front of it is a courtesy, not the
 * defence. Shown as `K7QM-4XPD-R2TW`; typed any way.
 */
export const PASS_CODE_LENGTH = 12;
export const PASS_CODE_PATTERN = /^[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{12}$/;

export function generatePassCode(random: (max: number) => number = randomInt): string {
  let code = '';
  for (let i = 0; i < PASS_CODE_LENGTH; i++) {
    code += ORDER_REFERENCE_ALPHABET[random(ORDER_REFERENCE_ALPHABET.length)];
  }
  return code;
}

/** "k7qm 4xpd-r2tw" → "K7QM4XPDR2TW", or null when it cannot be a pass code. */
export function normalisePassCode(raw: string): string | null {
  const code = raw.toUpperCase().replace(/[\s-]/g, '');
  return PASS_CODE_PATTERN.test(code) ? code : null;
}

export function formatPassCode(code: string): string {
  return code.replace(/(.{4})(?=.)/g, '$1-');
}

/** Doors open this long before the start: from then on, scans are real. */
export const DOORS_OPEN_HOURS_BEFORE = 4;
/** An event with no end time is assumed to run this long. */
export const DEFAULT_EVENT_HOURS = 6;
/** Passes keep working this long after the end (late sync, stragglers). */
export const AFTER_END_GRACE_HOURS = 6;

export interface DoorWindow {
  /** Before this, scans are practice: answered, logged, never checked in. */
  validFrom: Date;
  /** After this, the pass stops working. */
  validUntil: Date;
}

/**
 * Derived from the event's CURRENT dates every time — never stored — so
 * moving the event can never strand a pass or leave one open.
 */
export function doorWindow(event: { startsAt: Date; endsAt: Date | null }): DoorWindow {
  const end = event.endsAt ?? addHours(event.startsAt, DEFAULT_EVENT_HOURS);
  return {
    validFrom: addHours(event.startsAt, -DOORS_OPEN_HOURS_BEFORE),
    validUntil: addHours(end, AFTER_END_GRACE_HOURS),
  };
}
