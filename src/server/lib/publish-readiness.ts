/**
 * Publish readiness — the checklist an event must pass before it can go
 * live. Returns the problems, not a boolean, so the admin page can show
 * exactly what blocks publishing and the service can refuse for the same
 * reasons: one source of truth for both.
 *
 */

export type PublishProblemCode =
  'no_ticket_types' | 'no_cover_image' | 'starts_in_past' | 'registration_window_invalid';

export interface PublishProblem {
  code: PublishProblemCode;
  message: string;
}

export interface PublishReadinessInput {
  event: {
    startsAt: Date;
    registrationOpensAt: Date | null;
    registrationClosesAt: Date | null;
    imageKey: string | null;
  };
  ticketTypeCount: number;
  now: Date;
}

const MESSAGES: Record<PublishProblemCode, string> = {
  no_ticket_types: 'Add at least one ticket type',
  no_cover_image: 'Upload a cover image (used on the event page and Facebook shares)',
  starts_in_past: 'The event start must be in the future',
  registration_window_invalid:
    'Registration must open before it closes, and close no later than the event start',
};

export function describePublishProblem(code: PublishProblemCode): string {
  return MESSAGES[code];
}

/** The full checklist in display order; used to render ✓/✗ rows. */
export const PUBLISH_CHECKS: readonly PublishProblemCode[] = [
  'no_ticket_types',
  'no_cover_image',
  'starts_in_past',
  'registration_window_invalid',
];

export function publishReadiness({
  event,
  ticketTypeCount,
  now,
}: PublishReadinessInput): PublishProblem[] {
  const problems: PublishProblem[] = [];

  if (ticketTypeCount < 1) problems.push(problem('no_ticket_types'));

  if (!event.imageKey) problems.push(problem('no_cover_image'));

  // "Starts exactly now" is already too late to sell a ticket.
  if (event.startsAt.getTime() <= now.getTime()) problems.push(problem('starts_in_past'));

  const { registrationOpensAt: opens, registrationClosesAt: closes } = event;
  const windowValid =
    opens !== null &&
    closes !== null &&
    opens.getTime() < closes.getTime() &&
    closes.getTime() <= event.startsAt.getTime();
  if (!windowValid) problems.push(problem('registration_window_invalid'));

  return problems;
}

function problem(code: PublishProblemCode): PublishProblem {
  return { code, message: MESSAGES[code] };
}
