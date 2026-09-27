import { beforeEach, describe, expect, it, vi } from 'vitest';
import { EventSlugTakenError, SponsorNotFoundError } from '@/server/lib/errors';

/**
 * B5 event form actions, for the presenting sponsor (Canvas 6, N11): the
 * select reaches the service as an id or null, and a sponsor deleted while
 * the form was open lands beside the select with what was typed kept. The
 * service is mocked.
 */
const requireAdmin = vi.fn();
const createEvent = vi.fn();
const updateEvent = vi.fn();

vi.mock('next/navigation', () => ({
  redirect: (url: string) => {
    throw new Error(`REDIRECT ${url}`);
  },
}));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('@/lib/session', () => ({ requireAdmin: () => requireAdmin() }));
vi.mock('@/server/container', () => ({ eventsService: { createEvent, updateEvent } }));

const { createEventAction, updateEventAction } =
  await import('@/app/admin/(protected)/events/actions');

const EVENT_ID = '3c4d5e6f-7a8b-4c9d-8e0f-1a2b3c4d5e6f';
const SPONSOR_ID = '5f0c7a8e-2b4d-4e61-9a3f-8c1d2e3f4a5b';

function form(extra: Record<string, string> = {}): FormData {
  const f = new FormData();
  for (const [k, v] of Object.entries({
    title: 'Launch Night',
    slug: '',
    description: '',
    venue: 'ICCB Hall 4, Dhaka',
    startsAt: '2026-10-01T19:00',
    endsAt: '',
    registrationOpensAt: '',
    registrationClosesAt: '',
    presentingSponsorId: SPONSOR_ID,
    ...extra,
  })) {
    f.set(k, v);
  }
  return f;
}

beforeEach(() => {
  requireAdmin.mockReset().mockResolvedValue({ email: 'raj@example.com', role: 'admin' });
  createEvent.mockReset();
  updateEvent.mockReset();
});

describe('event form actions — presenting sponsor', () => {
  it('passes the chosen sponsor to the service; "None" is null', async () => {
    createEvent.mockResolvedValue({ id: EVENT_ID });
    await expect(createEventAction({}, form())).rejects.toThrow(
      `REDIRECT /admin/events/${EVENT_ID}/edit`,
    );
    expect(createEvent.mock.calls[0]?.[0]).toMatchObject({ presentingSponsorId: SPONSOR_ID });

    updateEvent.mockResolvedValue({ id: EVENT_ID });
    await expect(
      updateEventAction(EVENT_ID, {}, form({ presentingSponsorId: '' })),
    ).rejects.toThrow(`REDIRECT /admin/events/${EVENT_ID}/edit?saved=1`);
    expect(updateEvent.mock.calls[0]?.[1]).toMatchObject({ presentingSponsorId: null });
  });

  it('a sponsor deleted meanwhile is refused beside the select, input kept', async () => {
    updateEvent.mockRejectedValue(new SponsorNotFoundError(SPONSOR_ID));
    const state = await updateEventAction(EVENT_ID, {}, form());
    expect(state).toEqual({
      error: 'That sponsor has been deleted. Choose another, or None.',
      field: 'presentingSponsorId',
      values: expect.objectContaining({ title: 'Launch Night', presentingSponsorId: SPONSOR_ID }),
    });

    createEvent.mockRejectedValue(new SponsorNotFoundError(SPONSOR_ID));
    expect((await createEventAction({}, form())).field).toBe('presentingSponsorId');
  });

  it('a value that is not a sponsor id never reaches the service', async () => {
    const state = await createEventAction({}, form({ presentingSponsorId: 'kolorob' }));
    expect(state).toMatchObject({
      error: 'Choose a presenting sponsor from the list',
      field: 'presentingSponsorId',
    });
    expect(createEvent).not.toHaveBeenCalled();
  });

  it('other errors stay in the banner, with no field', async () => {
    createEvent.mockRejectedValue(new EventSlugTakenError('launch-night'));
    const state = await createEventAction({}, form());
    expect(state.error).toBe('That URL slug is already in use');
    expect(state.field).toBeUndefined();

    const blank = await createEventAction({}, form({ title: ' ' }));
    expect(blank).toMatchObject({ error: 'Title is required', field: undefined });
  });
});
