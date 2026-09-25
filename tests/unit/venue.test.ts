import { describe, expect, it } from 'vitest';
import {
  VENUE_PRIVATE_NOTE,
  forPublic,
  publicVenue,
  publicVenueLine,
  venueCity,
} from '@/server/lib/venue';
import { eventFormSchema } from '@/lib/validation/events';

/**
 * ADR-029 private venue: the pure rule public pages use, and the form rule
 * that a private venue must exist (ticket holders are promised it).
 */
const shown = { venue: 'ICCB Hall 4, Dhaka', venueHidden: false, venueArea: null };
const hidden = {
  venue: 'Warehouse 7, Tejgaon I/A',
  venueHidden: true,
  venueArea: 'Tejgaon, Dhaka',
};

describe('forPublic', () => {
  it('removes a private venue and keeps everything else', () => {
    expect(forPublic({ ...hidden, title: 'X' })).toEqual({
      venue: null,
      venueHidden: true,
      venueArea: 'Tejgaon, Dhaka',
      title: 'X',
    });
  });

  it('leaves a public venue exactly as it is', () => {
    const e = { ...shown, title: 'X' };
    expect(forPublic(e)).toBe(e);
  });
});

describe('publicVenue / publicVenueLine', () => {
  it('a public venue is shown, with a map link', () => {
    expect(publicVenue(shown)).toEqual({
      text: 'ICCB Hall 4, Dhaka',
      isPrivate: false,
      mapsQuery: 'ICCB Hall 4, Dhaka',
    });
    expect(publicVenueLine(shown)).toBe('ICCB Hall 4, Dhaka');
  });

  it('a private venue shows the area and the note — never the venue, never a map', () => {
    expect(publicVenue(hidden)).toEqual({
      text: 'Tejgaon, Dhaka',
      isPrivate: true,
      mapsQuery: null,
    });
    expect(publicVenueLine(hidden)).toBe(`Tejgaon, Dhaka · ${VENUE_PRIVATE_NOTE}`);
    // Even when handed the unstripped event, nothing prints the venue.
    expect(JSON.stringify([publicVenue(hidden), publicVenueLine(hidden)])).not.toContain(
      'Warehouse',
    );
  });

  it('a private venue with no area is the note alone; no venue at all is nothing', () => {
    expect(publicVenueLine({ ...hidden, venueArea: null })).toBe(VENUE_PRIVATE_NOTE);
    expect(publicVenue({ venue: null, venueHidden: false, venueArea: null }).text).toBeNull();
    expect(publicVenueLine({ venue: null, venueHidden: false, venueArea: null })).toBeNull();
  });
});

describe('venueCity', () => {
  it('a public venue gives the last comma part, trimmed', () => {
    expect(venueCity(shown)).toBe('Dhaka');
    expect(venueCity({ ...shown, venue: 'Bayside Hall, Khulshi,  Chattogram ' })).toBe(
      'Chattogram',
    );
  });

  it('a private venue only ever yields its area', () => {
    expect(venueCity(hidden)).toBe('Dhaka');
    // The hidden venue has a comma of its own; it must never be read.
    expect(venueCity({ ...hidden, venueArea: 'Tejgaon' })).toBeNull();
    expect(venueCity({ ...hidden, venueArea: null })).toBeNull();
  });

  it('no comma, a trailing comma, or no venue is nothing', () => {
    expect(venueCity({ ...shown, venue: 'The Attic' })).toBeNull();
    expect(venueCity({ ...shown, venue: 'The Attic, ' })).toBeNull();
    expect(venueCity({ venue: null, venueHidden: false, venueArea: null })).toBeNull();
  });
});

describe('eventFormSchema — private venue', () => {
  const base = {
    title: 'Launch Night',
    slug: '',
    description: '',
    venue: 'Warehouse 7, Tejgaon I/A',
    startsAt: '2026-10-01T19:00',
    endsAt: '',
    registrationOpensAt: '',
    registrationClosesAt: '',
  };

  it('the checkbox reads as a boolean and the area is trimmed', () => {
    const on = eventFormSchema.parse({
      ...base,
      venueHidden: 'on',
      venueArea: '  Tejgaon, Dhaka ',
    });
    expect(on).toMatchObject({ venueHidden: true, venueArea: 'Tejgaon, Dhaka' });
    expect(eventFormSchema.parse(base)).toMatchObject({ venueHidden: false });
  });

  it('refuses private with no venue — ticket holders need one', () => {
    const r = eventFormSchema.safeParse({ ...base, venue: '', venueHidden: 'on' });
    expect(r.success).toBe(false);
    expect(r.error?.issues[0]).toMatchObject({
      path: ['venue'],
      message: 'Add the venue to keep it private — ticket holders need it',
    });
  });
});
