import { subDays } from 'date-fns';

/**
 * Business rule (CLAUDE.md): registration opens 20 days before an event and
 * closes 5 days before. These are defaults — the window is stored explicitly
 * on each event so a specific event can override it.
 *
 * Bangladesh has no daylight-saving time, so subtracting days from the UTC
 * instant keeps the same Dhaka wall-clock time.
 */
export const REGISTRATION_OPENS_DAYS_BEFORE = 20;
export const REGISTRATION_CLOSES_DAYS_BEFORE = 5;

export interface RegistrationWindow {
  registrationOpensAt: Date;
  registrationClosesAt: Date;
}

export function defaultRegistrationWindow(startsAt: Date): RegistrationWindow {
  return {
    registrationOpensAt: subDays(startsAt, REGISTRATION_OPENS_DAYS_BEFORE),
    registrationClosesAt: subDays(startsAt, REGISTRATION_CLOSES_DAYS_BEFORE),
  };
}
