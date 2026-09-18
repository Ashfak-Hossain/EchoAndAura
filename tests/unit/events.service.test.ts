import { describe, expect, it, vi } from 'vitest';
import {
  CoverImageInvalidError,
  CoverImageNotUploadedError,
  EventNotFoundError,
  EventNotPublishableError,
  EventSlugTakenError,
  EventStatusConflictError,
  InvalidEventTransitionError,
} from '@/server/lib/errors';
import type {
  EventPatch,
  EventRecord,
  EventsRepository,
  NewEvent,
} from '@/server/repositories/events.repository';
import type {
  TicketTypeRecord,
  TicketTypesRepository,
} from '@/server/repositories/ticket-types.repository';
import { createEventsService } from '@/server/services/events.service';
import type { ObjectStorage, StoredObjectInfo } from '@/server/storage/object-storage';

/**
 * In-memory repository honouring the same contract as the real one: the slug
 * is unique, and a duplicate surfaces as EventSlugTakenError.
 */
function fakeRepo(seed: EventRecord[] = []) {
  const rows = new Map<string, EventRecord>(seed.map((r) => [r.id, r]));
  let counter = 0;

  const materialise = (values: NewEvent): EventRecord => ({
    id: values.id ?? `id-${++counter}`,
    slug: values.slug,
    title: values.title,
    description: values.description ?? null,
    venue: values.venue ?? null,
    startsAt: values.startsAt,
    endsAt: values.endsAt ?? null,
    registrationOpensAt: values.registrationOpensAt ?? null,
    registrationClosesAt: values.registrationClosesAt ?? null,
    status: values.status ?? 'draft',
    imageKey: values.imageKey ?? null,
    createdAt: new Date('2026-01-01T00:00:00Z'),
    updatedAt: new Date('2026-01-01T00:00:00Z'),
  });

  const slugTaken = (slug: string, exceptId?: string) =>
    [...rows.values()].some((r) => r.slug === slug && r.id !== exceptId);

  const repo: EventsRepository = {
    async list() {
      return [...rows.values()];
    },
    async findById(id) {
      return rows.get(id) ?? null;
    },
    async insert(values) {
      if (slugTaken(values.slug)) throw new EventSlugTakenError(values.slug);
      const row = materialise(values);
      rows.set(row.id, row);
      return row;
    },
    async update(id, patch: EventPatch) {
      const existing = rows.get(id);
      if (!existing) return null;
      if (patch.slug && slugTaken(patch.slug, id)) throw new EventSlugTakenError(patch.slug);
      const row = { ...existing, ...patch, updatedAt: new Date() };
      rows.set(id, row);
      return row;
    },
    async setImageKey(id, imageKey) {
      const existing = rows.get(id);
      if (!existing) return null;
      const row = { ...existing, imageKey, updatedAt: new Date() };
      rows.set(id, row);
      return row;
    },
    // Conditional like the real UPDATE ... WHERE status = from.
    async transitionStatus(id, from, to) {
      const existing = rows.get(id);
      if (!existing || existing.status !== from) return null;
      const row = { ...existing, status: to, updatedAt: new Date() };
      rows.set(id, row);
      return row;
    },
  };
  return { repo, rows };
}

/** Ticket-types repository stub: only `listByEvent` matters to the events service. */
function fakeTicketTypes(countByEvent: Record<string, number> = {}): TicketTypesRepository {
  const unused = () => Promise.reject(new Error('not used by events service'));
  return {
    async listByEvent(eventId) {
      return Array.from(
        { length: countByEvent[eventId] ?? 0 },
        (_, i) => ({ id: `tt-${i}`, eventId }) as TicketTypeRecord,
      );
    },
    findById: unused,
    insert: unused,
    update: unused,
    delete: unused,
  };
}

/** In-memory object storage: `objects` is what a browser "uploaded". */
function fakeStorage(objects: Record<string, StoredObjectInfo> = {}) {
  const store = new Map(Object.entries(objects));
  const deleted: string[] = [];
  const storage: ObjectStorage = {
    async createUploadUrl({ key }) {
      return { url: `https://storage.test/put/${key}`, key, expiresInSeconds: 300 };
    },
    async head(key) {
      return store.get(key) ?? null;
    },
    async delete(key) {
      store.delete(key);
      deleted.push(key);
    },
    publicUrl(key) {
      return `https://cdn.test/${key}`;
    },
  };
  return { storage, store, deleted };
}

const NOW = new Date('2026-09-18T10:00:00Z');
const clock = { now: () => NOW };

const startsAt = new Date('2026-10-01T13:00:00Z');

describe('eventsService.createEvent', () => {
  it('derives the slug from the title and fills the default registration window', async () => {
    const { repo } = fakeRepo();
    const svc = createEventsService(repo, fakeTicketTypes(), fakeStorage().storage, clock);

    const event = await svc.createEvent({ title: 'Launch Night 2026', startsAt });

    expect(event.slug).toBe('launch-night-2026');
    expect(event.status).toBe('draft');
    expect(event.registrationOpensAt?.toISOString()).toBe('2026-09-11T13:00:00.000Z');
    expect(event.registrationClosesAt?.toISOString()).toBe('2026-09-26T13:00:00.000Z');
  });

  it('respects an explicit slug and explicit registration window', async () => {
    const svc = createEventsService(fakeRepo().repo, fakeTicketTypes(), fakeStorage().storage, clock);
    const opens = new Date('2026-09-01T00:00:00Z');
    const closes = new Date('2026-09-30T00:00:00Z');

    const event = await svc.createEvent({
      title: 'Launch Night',
      slug: 'custom-url',
      startsAt,
      registrationOpensAt: opens,
      registrationClosesAt: closes,
    });

    expect(event.slug).toBe('custom-url');
    expect(event.registrationOpensAt).toEqual(opens);
    expect(event.registrationClosesAt).toEqual(closes);
  });

  it('fills only the missing registration bound', async () => {
    const svc = createEventsService(fakeRepo().repo, fakeTicketTypes(), fakeStorage().storage, clock);
    const closes = new Date('2026-09-30T00:00:00Z');

    const event = await svc.createEvent({ title: 'X', startsAt, registrationClosesAt: closes });

    expect(event.registrationOpensAt?.toISOString()).toBe('2026-09-11T13:00:00.000Z');
    expect(event.registrationClosesAt).toEqual(closes);
  });

  // Failure path: uniqueness is the repository/DB's job; the service must let
  // the typed error through untouched so the action can name the field.
  it('surfaces EventSlugTakenError on a duplicate slug', async () => {
    const svc = createEventsService(fakeRepo().repo, fakeTicketTypes(), fakeStorage().storage, clock);
    await svc.createEvent({ title: 'Same Title', startsAt });

    await expect(svc.createEvent({ title: 'Same Title', startsAt })).rejects.toBeInstanceOf(
      EventSlugTakenError,
    );
  });
});

describe('eventsService.updateEvent / getEvent', () => {
  it('throws EventNotFoundError for an unknown id', async () => {
    const svc = createEventsService(fakeRepo().repo, fakeTicketTypes(), fakeStorage().storage, clock);
    await expect(svc.getEvent('missing')).rejects.toBeInstanceOf(EventNotFoundError);
    await expect(svc.updateEvent('missing', { title: 'X', startsAt })).rejects.toBeInstanceOf(
      EventNotFoundError,
    );
  });

  it('replaces the editable fields and re-derives blanks', async () => {
    const { repo, rows } = fakeRepo();
    const svc = createEventsService(repo, fakeTicketTypes(), fakeStorage().storage, clock);
    const created = await svc.createEvent({
      title: 'Old',
      venue: 'Dhaka',
      startsAt,
      endsAt: new Date('2026-10-01T16:00:00Z'),
    });

    const newStart = new Date('2026-11-01T13:00:00Z');
    const updated = await svc.updateEvent(created.id, { title: 'New Title', startsAt: newStart });

    expect(updated.title).toBe('New Title');
    expect(updated.slug).toBe('new-title');
    expect(updated.venue).toBeNull();
    expect(updated.endsAt).toBeNull();
    expect(updated.registrationOpensAt?.toISOString()).toBe('2026-10-12T13:00:00.000Z');
    expect(rows.get(created.id)?.title).toBe('New Title');
  });

  it('surfaces EventSlugTakenError when renaming onto another event slug', async () => {
    const svc = createEventsService(fakeRepo().repo, fakeTicketTypes(), fakeStorage().storage, clock);
    await svc.createEvent({ title: 'First', startsAt });
    const second = await svc.createEvent({ title: 'Second', startsAt });

    await expect(
      svc.updateEvent(second.id, { title: 'Second', slug: 'first', startsAt }),
    ).rejects.toBeInstanceOf(EventSlugTakenError);
  });
});

describe('eventsService.changeEventStatus', () => {
  async function draftEvent(ticketTypeCount: number) {
    const { repo, rows } = fakeRepo();
    const svc = createEventsService(
      repo,
      fakeTicketTypes({ 'id-1': ticketTypeCount }),
      fakeStorage().storage,
      clock,
    );
    const created = await svc.createEvent({ title: 'Launch', startsAt });
    // Readiness also needs a cover image; set it directly on the fake row.
    const event = (await repo.setImageKey(created.id, 'events/id-1/cover-abcdefghijkl.jpg'))!;
    return { svc, repo, rows, event };
  }

  it('publishes a ready draft', async () => {
    const { svc, event } = await draftEvent(3);
    const published = await svc.changeEventStatus(event.id, 'published');
    expect(published.status).toBe('published');
  });

  it('refuses to publish without ticket types, listing every problem, without touching status', async () => {
    const { svc, repo, event } = await draftEvent(0);
    const spy = vi.spyOn(repo, 'transitionStatus');

    const err = await svc.changeEventStatus(event.id, 'published').catch((e: unknown) => e);
    expect(err).toBeInstanceOf(EventNotPublishableError);
    expect((err as EventNotPublishableError).problems).toEqual(['Add at least one ticket type']);
    expect(spy).not.toHaveBeenCalled();
    expect((await svc.getEvent(event.id)).status).toBe('draft');
  });

  it('refuses to publish an event that has already started', async () => {
    const { repo } = fakeRepo();
    const svc = createEventsService(repo, fakeTicketTypes({ 'id-1': 1 }), fakeStorage().storage, {
      now: () => new Date('2030-01-01T00:00:00Z'),
    });
    const created = await svc.createEvent({ title: 'Past', startsAt });
    const event = (await repo.setImageKey(created.id, 'events/id-1/cover-abcdefghijkl.jpg'))!;
    await expect(svc.changeEventStatus(event.id, 'published')).rejects.toBeInstanceOf(
      EventNotPublishableError,
    );
  });

  it('walks the full lifecycle: publish → unpublish → archive → restore', async () => {
    const { svc, event } = await draftEvent(1);
    expect((await svc.changeEventStatus(event.id, 'published')).status).toBe('published');
    expect((await svc.changeEventStatus(event.id, 'draft')).status).toBe('draft');
    expect((await svc.changeEventStatus(event.id, 'archived')).status).toBe('archived');
    expect((await svc.changeEventStatus(event.id, 'draft')).status).toBe('draft');
  });

  // Failure paths.
  it('throws InvalidEventTransitionError before any repository write', async () => {
    const { svc, repo, event } = await draftEvent(1);
    const spy = vi.spyOn(repo, 'transitionStatus');
    await expect(svc.changeEventStatus(event.id, 'draft')).rejects.toBeInstanceOf(
      InvalidEventTransitionError,
    );
    await svc.changeEventStatus(event.id, 'archived');
    await expect(svc.changeEventStatus(event.id, 'published')).rejects.toBeInstanceOf(
      InvalidEventTransitionError,
    );
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it('throws EventStatusConflictError when the status moved under us', async () => {
    const { svc, repo, rows, event } = await draftEvent(1);
    // Simulate another admin publishing between our read and our write.
    const original = repo.transitionStatus.bind(repo);
    vi.spyOn(repo, 'transitionStatus').mockImplementation(async (id, from, to) => {
      rows.set(id, { ...rows.get(id)!, status: 'published' });
      return original(id, from, to);
    });
    await expect(svc.changeEventStatus(event.id, 'published')).rejects.toBeInstanceOf(
      EventStatusConflictError,
    );
    expect(rows.get(event.id)?.status).toBe('published');
  });

  it('throws EventNotFoundError for an unknown id', async () => {
    const svc = createEventsService(fakeRepo().repo, fakeTicketTypes(), fakeStorage().storage, clock);
    await expect(svc.changeEventStatus('missing', 'published')).rejects.toBeInstanceOf(
      EventNotFoundError,
    );
    await expect(svc.publishReadinessFor('missing')).rejects.toBeInstanceOf(EventNotFoundError);
  });
});

describe('eventsService.publishReadinessFor', () => {
  it('reports the same problems the publish gate uses', async () => {
    const { repo } = fakeRepo();
    const svc = createEventsService(repo, fakeTicketTypes(), fakeStorage().storage, clock);
    const event = await svc.createEvent({ title: 'X', startsAt });
    const problems = await svc.publishReadinessFor(event.id);
    expect(problems.map((p) => p.code)).toEqual(['no_ticket_types', 'no_cover_image']);
  });
});

describe('eventsService cover image', () => {
  const PNG = { contentType: 'image/png', size: 1234 };

  async function setup(objects: Record<string, StoredObjectInfo> = {}) {
    const { repo, rows } = fakeRepo();
    const fs = fakeStorage(objects);
    const warnings: string[] = [];
    const svc = createEventsService(repo, fakeTicketTypes(), fs.storage, {
      ...clock,
      warn: (m) => warnings.push(m),
    });
    const event = await svc.createEvent({ title: 'Cover', startsAt });
    return { svc, repo, rows, ...fs, warnings, event };
  }

  it('presigns an upload under the event prefix after validating the claim', async () => {
    const { svc, event } = await setup();
    const target = await svc.createCoverUpload(event.id, PNG);
    expect(target.key).toMatch(new RegExp(`^events/${event.id}/cover-[A-Za-z0-9_-]{12}\\.png$`));
    expect(target.url).toContain(target.key);
  });

  it('refuses to presign a bad type or an oversized file', async () => {
    const { svc, event } = await setup();
    await expect(
      svc.createCoverUpload(event.id, { contentType: 'image/gif', size: 10 }),
    ).rejects.toBeInstanceOf(CoverImageInvalidError);
    await expect(
      svc.createCoverUpload(event.id, { contentType: 'image/png', size: 6 * 1024 * 1024 }),
    ).rejects.toBeInstanceOf(CoverImageInvalidError);
  });

  it('sets the cover only when the uploaded object exists and passes validation', async () => {
    const { svc, event } = await setup();
    const { key } = await svc.createCoverUpload(event.id, PNG);

    // Nothing uploaded yet.
    await expect(svc.setCoverImage(event.id, key)).rejects.toBeInstanceOf(
      CoverImageNotUploadedError,
    );
  });

  it('rejects a key that this event could not have been issued', async () => {
    const { svc, event, store } = await setup();
    const foreign = 'events/other-event/cover-abcdefghijkl.png';
    store.set(foreign, PNG);
    await expect(svc.setCoverImage(event.id, foreign)).rejects.toBeInstanceOf(
      CoverImageNotUploadedError,
    );
    expect((await svc.getEvent(event.id)).imageKey).toBeNull();
  });

  it('rejects an object whose stored type or size fails validation', async () => {
    const { svc, event, store } = await setup();
    const { key } = await svc.createCoverUpload(event.id, PNG);
    store.set(key, { contentType: 'text/html', size: 10 });
    await expect(svc.setCoverImage(event.id, key)).rejects.toBeInstanceOf(CoverImageInvalidError);
  });

  it('replaces the cover and deletes the old object only after the row is updated', async () => {
    const { svc, event, store, deleted } = await setup();
    const first = await svc.createCoverUpload(event.id, PNG);
    store.set(first.key, PNG);
    await svc.setCoverImage(event.id, first.key);
    expect(deleted).toEqual([]);

    const second = await svc.createCoverUpload(event.id, PNG);
    store.set(second.key, PNG);
    const updated = await svc.setCoverImage(event.id, second.key);

    expect(updated.imageKey).toBe(second.key);
    expect(deleted).toEqual([first.key]);
    expect(svc.coverImageUrl(updated)).toBe(`https://cdn.test/${second.key}`);
  });

  it('removes the cover and deletes the object; a failed delete is logged, not thrown', async () => {
    const { svc, event, store, storage, warnings } = await setup();
    const { key } = await svc.createCoverUpload(event.id, PNG);
    store.set(key, PNG);
    await svc.setCoverImage(event.id, key);

    vi.spyOn(storage, 'delete').mockRejectedValueOnce(new Error('network'));
    const cleared = await svc.removeCoverImage(event.id);

    expect(cleared.imageKey).toBeNull();
    expect(svc.coverImageUrl(cleared)).toBeNull();
    expect(warnings).toHaveLength(1);
  });
});
