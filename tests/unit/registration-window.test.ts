import { describe, expect, it } from 'vitest';
import {
  REGISTRATION_CLOSES_DAYS_BEFORE,
  REGISTRATION_OPENS_DAYS_BEFORE,
  defaultRegistrationWindow,
} from '@/server/lib/registration-window';

describe('defaultRegistrationWindow', () => {
  // 1 Oct 2026, 19:00 Dhaka (UTC+6) — the pilot event.
  const startsAt = new Date('2026-10-01T13:00:00Z');

  it('encodes the business rule: opens 20 days before, closes 5 days before', () => {
    expect(REGISTRATION_OPENS_DAYS_BEFORE).toBe(20);
    expect(REGISTRATION_CLOSES_DAYS_BEFORE).toBe(5);
  });

  it('returns exact instants preserving the wall-clock time', () => {
    const { registrationOpensAt, registrationClosesAt } = defaultRegistrationWindow(startsAt);
    expect(registrationOpensAt.toISOString()).toBe('2026-09-11T13:00:00.000Z');
    expect(registrationClosesAt.toISOString()).toBe('2026-09-26T13:00:00.000Z');
  });

  it('does not mutate its input', () => {
    const copy = new Date(startsAt);
    defaultRegistrationWindow(copy);
    expect(copy.getTime()).toBe(startsAt.getTime());
  });
});
