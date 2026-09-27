import { describe, expect, it } from 'vitest';
import { eventFormSchema } from '@/lib/validation/events';

const valid = {
  title: '  Launch Night  ',
  slug: '',
  description: '',
  venue: 'Dhaka',
  startsAt: '2026-10-01T19:00',
  endsAt: '',
  registrationOpensAt: '',
  registrationClosesAt: '',
};

function firstMessage(input: Record<string, string>): string | undefined {
  const r = eventFormSchema.safeParse(input);
  return r.success ? undefined : r.error.issues[0]?.message;
}

describe('eventFormSchema', () => {
  it('accepts a minimal form, trims text, and blanks become undefined', () => {
    const r = eventFormSchema.safeParse(valid);
    expect(r.success).toBe(true);
    if (!r.success) return;
    expect(r.data.title).toBe('Launch Night');
    expect(r.data.slug).toBeUndefined();
    expect(r.data.description).toBeUndefined();
    expect(r.data.endsAt).toBeUndefined();
  });

  it('interprets datetime-local values as Dhaka wall time (UTC+6)', () => {
    const r = eventFormSchema.safeParse(valid);
    expect(r.success).toBe(true);
    if (!r.success) return;
    expect(r.data.startsAt.toISOString()).toBe('2026-10-01T13:00:00.000Z');
  });

  it('reads the presenting sponsor select: "None" and a missing field are null, a uuid is kept', () => {
    const id = '0b8e2f4c-6a1d-4c3e-9f57-2d8a1b6c9e03';
    const none = eventFormSchema.safeParse({ ...valid, presentingSponsorId: '' });
    expect(none.success && none.data.presentingSponsorId).toBeNull();
    // Null rather than undefined: the form is a full replace, so "None" clears it.
    const missing = eventFormSchema.safeParse(valid);
    expect(missing.success && missing.data.presentingSponsorId).toBeNull();
    const picked = eventFormSchema.safeParse({ ...valid, presentingSponsorId: ` ${id} ` });
    expect(picked.success && picked.data.presentingSponsorId).toBe(id);
  });

  it('lower-cases an explicit slug', () => {
    const r = eventFormSchema.safeParse({ ...valid, slug: 'Launch-Night' });
    expect(r.success && r.data.slug).toBe('launch-night');
  });

  // Failure paths.
  it('rejects a missing or blank title', () => {
    expect(firstMessage({ ...valid, title: '   ' })).toBe('Title is required');
  });

  it('rejects a slug with illegal characters', () => {
    expect(firstMessage({ ...valid, slug: 'launch night!' })).toMatch(/slug/i);
    expect(firstMessage({ ...valid, slug: '-leading' })).toMatch(/slug/i);
  });

  it('rejects an invalid start date', () => {
    expect(firstMessage({ ...valid, startsAt: 'tomorrow' })).toBe('Enter a valid date and time');
    expect(firstMessage({ ...valid, startsAt: '' })).toBe('Enter a valid date and time');
    expect(firstMessage({ ...valid, startsAt: '2026-13-45T19:00' })).toBe(
      'Enter a valid date and time',
    );
  });

  it('rejects a presenting sponsor that is not an id from the list', () => {
    expect(firstMessage({ ...valid, presentingSponsorId: 'kolorob' })).toBe(
      'Choose a presenting sponsor from the list',
    );
    expect(firstMessage({ ...valid, presentingSponsorId: '1; drop table events' })).toBe(
      'Choose a presenting sponsor from the list',
    );
  });

  it('rejects an end before the start', () => {
    expect(firstMessage({ ...valid, endsAt: '2026-10-01T18:00' })).toBe('End must be after start');
  });

  it('rejects registration closing after the event starts', () => {
    expect(firstMessage({ ...valid, registrationClosesAt: '2026-10-02T00:00' })).toBe(
      'Registration must close on or before the event start',
    );
  });

  it('rejects registration opening after it closes', () => {
    expect(
      firstMessage({
        ...valid,
        registrationOpensAt: '2026-09-27T00:00',
        registrationClosesAt: '2026-09-26T00:00',
      }),
    ).toBe('Registration must open before it closes');
  });
});
