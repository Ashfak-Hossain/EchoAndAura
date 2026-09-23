/**
 * Private venue (ADR-029). Public read models pass every event through
 * `forPublic`, so a hidden venue never reaches a public page, its share text
 * or the client payload. Ticket holders read the full event elsewhere
 * (tickets email, ticket page, PDF, calendar file).
 */

export const VENUE_PRIVATE_NOTE = 'Exact venue is sent with your tickets';

interface VenueFields {
  venue: string | null;
  venueHidden: boolean;
  venueArea: string | null;
}

/** The event as a public page may see it: a hidden venue is gone. */
export function forPublic<T extends VenueFields>(event: T): T {
  return event.venueHidden ? { ...event, venue: null } : event;
}

export interface PublicVenue {
  /** What to print where the venue goes: the venue, or the public area; null when neither. */
  text: string | null;
  /** True when the venue is private — show VENUE_PRIVATE_NOTE with (or instead of) `text`. */
  isPrivate: boolean;
  /** Only a shown venue gets a map link — an area would point people at the wrong door. */
  mapsQuery: string | null;
}

export function publicVenue(event: VenueFields): PublicVenue {
  if (event.venueHidden) {
    return { text: event.venueArea, isPrivate: true, mapsQuery: null };
  }
  return { text: event.venue, isPrivate: false, mapsQuery: event.venue };
}

/** One line for cards and headers: "Tejgaon, Dhaka · Exact venue is sent with your tickets". */
export function publicVenueLine(event: VenueFields): string | null {
  const v = publicVenue(event);
  if (!v.isPrivate) return v.text;
  return v.text ? `${v.text} · ${VENUE_PRIVATE_NOTE}` : VENUE_PRIVATE_NOTE;
}
