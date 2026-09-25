import { describe, expect, it, vi } from 'vitest';
import {
  CoverImageInvalidError,
  CoverImageNotUploadedError,
  EventNotFoundError,
  EventNotPublishableError,
  EventSlugTakenError,
  EventStatusConflictError,
  InvalidEventTransitionError,
  SponsorNotFoundError,
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
    venueHidden: values.venueHidden ?? false,
    venueArea: values.venueArea ?? null,
    startsAt: values.startsAt,
    endsAt: values.endsAt ?? null,
    registrationOpensAt: values.registrationOpensAt ?? null,
    registrationClosesAt: values.registrationClosesAt ?? null,
    status: values.status ?? 'draft',
    imageKey: values.imageKey ?? null,
    presentingSponsorId: values.presentingSponsorId ?? null,
    createdAt: new Date('2026-01-01T00:00:00Z'),
    updatedAt: new Date('2026-01-01T00:00:00Z'),
  });

  const slugTaken = (slug: string, exceptId?: string) =>
    [...rows.values()].some((r) => r.slug === slug && r.id !== exceptId);

  const repo: EventsRepository = {
    async list() {
      return [...rows.values()];
    },
    async listByStatus(statuses) {
      return [...rows.values()].filter((r) => statuses.includes(r.status));
    },
    async findById(id) {
      return rows.get(id) ?? null;
    },
    async findBySlug(slug) {
      return [...rows.values()].find((r) => r.slug === slug) ?? null;
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
    listByEvents: unused,
    findById: unused,
    capacityByEvent: unused,
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
      return {
        url: `https://storage.test/put/${key}`,
        key,
        expiresInSeconds: 300,
      };
    },
    async put({ key, body, contentType }) {
      store.set(key, { contentType, size: body.byteLength });
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

    const event = await svc.createEvent({
      title: 'Launch Night 2026',
      startsAt,
    });

    expect(event.slug).toBe('launch-night-2026');
    expect(event.status).toBe('draft');
    expect(event.registrationOpensAt?.toISOString()).toBe('2026-09-11T13:00:00.000Z');
    expect(event.registrationClosesAt?.toISOString()).toBe('2026-09-26T13:00:00.000Z');
  });

  it('respects an explicit slug and explicit registration window', async () => {
    const svc = createEventsService(
      fakeRepo().repo,
      fakeTicketTypes(),
      fakeStorage().storage,
      clock,
    );
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
    const svc = createEventsService(
      fakeRepo().repo,
      fakeTicketTypes(),
      fakeStorage().storage,
      clock,
    );
    const closes = new Date('2026-09-30T00:00:00Z');

    const event = await svc.createEvent({
      title: 'X',
      startsAt,
      registrationClosesAt: closes,
    });

    expect(event.registrationOpensAt?.toISOString()).toBe('2026-09-11T13:00:00.000Z');
    expect(event.registrationClosesAt).toEqual(closes);
  });

  // Failure path: uniqueness is the repository/DB's job; the service must let
  // the typed error through untouched so the action can name the field.
  it('surfaces EventSlugTakenError on a duplicate slug', async () => {
    const svc = createEventsService(
      fakeRepo().repo,
      fakeTicketTypes(),
      fakeStorage().storage,
      clock,
    );
    await svc.createEvent({ title: 'Same Title', startsAt });

    await expect(svc.createEvent({ title: 'Same Title', startsAt })).rejects.toBeInstanceOf(
      EventSlugTakenError,
    );
  });

  // ADR-010: the column only ever holds allowlisted HTML, never raw input.
  it('sanitises the description on write and stores an empty editor as null', async () => {
    const svc = createEventsService(
      fakeRepo().repo,
      fakeTicketTypes(),
      fakeStorage().storage,
      clock,
    );

    const dirty = await svc.createEvent({
      title: 'A',
      startsAt,
      description: '<p onclick="x()">Hi <b>there</b></p><script>alert(1)</script>',
    });
    expect(dirty.description).toBe('<p>Hi <strong>there</strong></p>');

    const plain = await svc.createEvent({ title: 'B', startsAt, description: 'Tom & Jerry' });
    expect(plain.description).toBe('<p>Tom &amp; Jerry</p>');

    const empty = await svc.createEvent({ title: 'C', startsAt, description: '<p></p>' });
    expect(empty.description).toBeNull();

    const updated = await svc.updateEvent(empty.id, {
      title: 'C',
      startsAt,
      description: '<p><a href="javascript:alert(1)">x</a></p>',
    });
    expect(updated.description).not.toContain('javascript:');
  });
});

describe('eventsService.updateEvent / getEvent', () => {
  it('throws EventNotFoundError for an unknown id', async () => {
    const svc = createEventsService(
      fakeRepo().repo,
      fakeTicketTypes(),
      fakeStorage().storage,
      clock,
    );
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
    const updated = await svc.updateEvent(created.id, {
      title: 'New Title',
      startsAt: newStart,
    });

    expect(updated.title).toBe('New Title');
    expect(updated.slug).toBe('new-title');
    expect(updated.venue).toBeNull();
    expect(updated.endsAt).toBeNull();
    expect(updated.registrationOpensAt?.toISOString()).toBe('2026-10-12T13:00:00.000Z');
    expect(rows.get(created.id)?.title).toBe('New Title');
  });

  it('surfaces EventSlugTakenError when renaming onto another event slug', async () => {
    const svc = createEventsService(
      fakeRepo().repo,
      fakeTicketTypes(),
      fakeStorage().storage,
      clock,
    );
    await svc.createEvent({ title: 'First', startsAt });
    const second = await svc.createEvent({ title: 'Second', startsAt });

    await expect(
      svc.updateEvent(second.id, { title: 'Second', slug: 'first', startsAt }),
    ).rejects.toBeInstanceOf(EventSlugTakenError);
  });
});

// Canvas 6, N11: "Presented by" is one optional column on the event,
// replaced by every save like the rest of the form.
describe('eventsService — presenting sponsor', () => {
  const KOLOROB = '5f0c7a8e-2b4d-4e61-9a3f-8c1d2e3f4a5b';
  const MEGH = '9a1b2c3d-4e5f-4a6b-8c7d-0e1f2a3b4c5d';

  it('stores the presenter on create; none is null', async () => {
    const { repo, rows } = fakeRepo();
    const svc = createEventsService(repo, fakeTicketTypes(), fakeStorage().storage, clock);

    const presented = await svc.createEvent({ title: 'A', startsAt, presentingSponsorId: KOLOROB });
    expect(presented.presentingSponsorId).toBe(KOLOROB);
    expect(rows.get(presented.id)?.presentingSponsorId).toBe(KOLOROB);

    const plain = await svc.createEvent({ title: 'B', startsAt, presentingSponsorId: null });
    expect(plain.presentingSponsorId).toBeNull();
    expect((await svc.createEvent({ title: 'C', startsAt })).presentingSponsorId).toBeNull();
  });

  it('update replaces it: another sponsor, then None clears it', async () => {
    const { repo } = fakeRepo();
    const svc = createEventsService(repo, fakeTicketTypes(), fakeStorage().storage, clock);
    const created = await svc.createEvent({ title: 'A', startsAt, presentingSponsorId: KOLOROB });

    const swapped = await svc.updateEvent(created.id, {
      title: 'A',
      startsAt,
      presentingSponsorId: MEGH,
    });
    expect(swapped.presentingSponsorId).toBe(MEGH);

    // Full-form replace: a save without a presenter ("None") clears it.
    const cleared = await svc.updateEvent(created.id, { title: 'A', startsAt });
    expect(cleared.presentingSponsorId).toBeNull();
  });

  // Failure path: the FK is the existence check (a sponsor deleted while the
  // form was open); the service lets the repository's typed error through.
  it('surfaces SponsorNotFoundError from the repository on create and update', async () => {
    const { repo } = fakeRepo();
    const refusing: EventsRepository = {
      ...repo,
      insert: (values) =>
        values.presentingSponsorId
          ? Promise.reject(new SponsorNotFoundError(values.presentingSponsorId))
          : repo.insert(values),
      update: (id, patch) =>
        patch.presentingSponsorId
          ? Promise.reject(new SponsorNotFoundError(patch.presentingSponsorId))
          : repo.update(id, patch),
    };
    const svc = createEventsService(refusing, fakeTicketTypes(), fakeStorage().storage, clock);

    await expect(
      svc.createEvent({ title: 'A', startsAt, presentingSponsorId: KOLOROB }),
    ).rejects.toBeInstanceOf(SponsorNotFoundError);
    const created = await svc.createEvent({ title: 'B', startsAt });
    await expect(
      svc.updateEvent(created.id, { title: 'B', startsAt, presentingSponsorId: MEGH }),
    ).rejects.toBeInstanceOf(SponsorNotFoundError);
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
    const svc = createEventsService(
      fakeRepo().repo,
      fakeTicketTypes(),
      fakeStorage().storage,
      clock,
    );
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
      svc.createCoverUpload(event.id, {
        contentType: 'image/png',
        size: 6 * 1024 * 1024,
      }),
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

describe('eventsService.getPublicEvent', () => {
  async function setup() {
    const { repo, rows } = fakeRepo();
    const svc = createEventsService(
      repo,
      fakeTicketTypes({ 'id-1': 2 }),
      fakeStorage().storage,
      clock,
    );
    const event = await svc.createEvent({ title: 'Public', startsAt });
    return { svc, repo, rows, event };
  }

  it('hides drafts and unknown slugs behind the same not-found', async () => {
    const { svc, event } = await setup();
    await expect(svc.getPublicEvent(event.slug)).rejects.toBeInstanceOf(EventNotFoundError);
    await expect(svc.getPublicEvent('nope')).rejects.toBeInstanceOf(EventNotFoundError);
  });

  it('resolves published and archived events with their ticket types', async () => {
    const { svc, repo, event } = await setup();
    await repo.transitionStatus(event.id, 'draft', 'published');
    const pub = await svc.getPublicEvent(event.slug);
    expect(pub.event.id).toBe(event.id);
    expect(pub.ticketTypes).toHaveLength(2);

    await repo.transitionStatus(event.id, 'published', 'archived');
    await expect(svc.getPublicEvent(event.slug)).resolves.toBeTruthy();
  });
});

describe('eventsService.getHomePage', () => {
  let typeCount = 0;
  const tt = (eventId: string, over: Partial<TicketTypeRecord> = {}): TicketTypeRecord => ({
    id: `tt-${++typeCount}`,
    eventId,
    name: 'General',
    pricePaisa: 120_000,
    quantityTotal: 100,
    quantitySold: 0,
    quantityReserved: 0,
    salesStartsAt: null,
    salesEndsAt: null,
    createdAt: NOW,
    updatedAt: NOW,
    ...over,
  });

  // One ticket-types read for every event shown — the tests assert it is one.
  const ticketTypesOf = (types: TicketTypeRecord[]): TicketTypesRepository => ({
    ...fakeTicketTypes(),
    listByEvents: vi.fn(async (ids: string[]) => types.filter((t) => ids.includes(t.eventId))),
  });

  const seed = (
    id: string,
    status: EventRecord['status'],
    startsAt: Date,
    over: Partial<EventRecord> = {},
  ): EventRecord =>
    ({
      id,
      slug: id,
      title: id,
      description: null,
      venue: null,
      startsAt,
      endsAt: null,
      registrationOpensAt: new Date('2026-01-01T00:00:00Z'),
      registrationClosesAt: new Date(startsAt.getTime() - 86_400_000),
      status,
      imageKey: status === 'published' ? `events/${id}/cover-x.png` : null,
      createdAt: NOW,
      updatedAt: NOW,
      ...over,
    }) as EventRecord;

  it('decorates hero, also-upcoming and past with phase, offer and cover in one ticket-types query', async () => {
    const { repo } = fakeRepo([
      seed('soon', 'published', new Date('2026-10-01T13:00:00Z')),
      seed('later', 'published', new Date('2026-11-14T12:30:00Z')),
      seed('gone', 'archived', new Date('2026-03-01T13:00:00Z')),
      seed('draft', 'draft', new Date('2026-10-20T13:00:00Z')),
    ]);
    const types = ticketTypesOf([
      tt('soon', { pricePaisa: 80_000, quantityTotal: 60, quantitySold: 20, quantityReserved: 10 }),
      tt('soon', { name: 'VIP', pricePaisa: 250_000, quantityTotal: 40, quantitySold: 20 }),
      tt('later', { pricePaisa: 60_000, quantityTotal: 50, quantitySold: 50 }),
      tt('draft', { pricePaisa: 1 }),
    ]);
    const svc = createEventsService(repo, types, fakeStorage().storage, clock);

    const home = await svc.getHomePage();

    expect(home.featured?.event.id).toBe('soon');
    expect(home.featured?.phase).toBe('open');
    expect(home.featured?.offer.fromPricePaisa).toBe(80_000);
    expect(home.featured?.offer.fromTypeName).toBe('General');
    // (60 − 20 − 10) + (40 − 20): stock left across every type.
    expect(home.featured?.availableTotal).toBe(50);
    expect(home.featured?.coverUrl).toBe('https://cdn.test/events/soon/cover-x.png');

    expect(home.alsoUpcoming.map((h) => h.event.id)).toEqual(['later']);
    expect(home.alsoUpcoming[0]?.phase).toBe('sold_out');
    // Nothing left to buy: the card still quotes a price.
    expect(home.alsoUpcoming[0]?.offer.fromPricePaisa).toBe(60_000);
    expect(home.upcomingTotal).toBe(2);

    expect(home.past.map((h) => h.event.id)).toEqual(['gone']);
    expect(home.past[0]?.phase).toBe('past');
    expect(home.past[0]?.offer.fromPricePaisa).toBeNull();
    expect(home.past[0]?.availableTotal).toBe(0);

    expect(types.listByEvents).toHaveBeenCalledTimes(1);
    expect(types.listByEvents).toHaveBeenCalledWith(['soon', 'later', 'gone']);
  });

  it('names the Early Bird while it sells, by the rule the event page uses', async () => {
    const startsAt = new Date('2026-10-20T13:00:00Z');
    const { repo } = fakeRepo([
      seed('eb', 'published', startsAt, {
        registrationOpensAt: new Date('2026-09-01T00:00:00Z'),
        registrationClosesAt: new Date('2026-10-15T13:00:00Z'),
      }),
    ]);
    const types = ticketTypesOf([
      tt('eb', { name: 'General', pricePaisa: 120_000 }),
      tt('eb', {
        name: 'Early Bird',
        pricePaisa: 60_000,
        salesEndsAt: new Date('2026-09-25T18:00:00Z'),
      }),
    ]);
    const svc = createEventsService(repo, types, fakeStorage().storage, clock);

    const { featured } = await svc.getHomePage();

    expect(featured?.offer).toMatchObject({
      fromPricePaisa: 60_000,
      fromIsEarlyBird: true,
      earlyBirdOnSale: true,
      earlyBird: { name: 'Early Bird' },
    });
    expect(featured?.offer.highlightId).toBe(featured?.offer.earlyBird?.id);
  });

  it('features the next show still on sale over a sooner one whose registration closed', async () => {
    const { repo } = fakeRepo([
      // Starts in 3 days; registration closed yesterday (the 5-day gap).
      seed('closed', 'published', new Date('2026-09-21T13:00:00Z'), {
        registrationClosesAt: new Date('2026-09-17T13:00:00Z'),
      }),
      seed('open', 'published', new Date('2026-10-20T13:00:00Z')),
    ]);
    const svc = createEventsService(
      repo,
      ticketTypesOf([tt('closed'), tt('open')]),
      fakeStorage().storage,
      clock,
    );

    const home = await svc.getHomePage();

    expect(home.featured?.event.id).toBe('open');
    expect(home.featured?.phase).toBe('open');
    expect(home.alsoUpcoming.map((h) => [h.event.id, h.phase])).toEqual([['closed', 'closed']]);
    expect(home.upcomingTotal).toBe(2);
  });

  it('returns the dormant state when nothing is published and upcoming', async () => {
    const { repo } = fakeRepo([seed('gone', 'archived', new Date('2026-03-01T13:00:00Z'))]);
    const svc = createEventsService(repo, ticketTypesOf([]), fakeStorage().storage, clock);
    const home = await svc.getHomePage();
    expect(home.featured).toBeNull();
    expect(home.alsoUpcoming).toEqual([]);
    expect(home.upcomingTotal).toBe(0);
    expect(home.past).toHaveLength(1);
  });

  it('getUpcomingPage: every upcoming published event soonest first, uncapped, in one ticket-types query', async () => {
    const upcoming = Array.from({ length: 8 }, (_, i) =>
      seed(`u${i}`, 'published', new Date(Date.UTC(2026, 10, 30 - i, 13))),
    );
    const { repo } = fakeRepo([
      ...upcoming,
      seed('gone', 'archived', new Date('2026-03-01T13:00:00Z')),
      seed('pulled', 'archived', new Date('2026-12-01T13:00:00Z')),
      seed('draft', 'draft', new Date('2026-10-20T13:00:00Z')),
    ]);
    const types = ticketTypesOf([tt('u7', { pricePaisa: 50_000 }), tt('gone')]);
    const svc = createEventsService(repo, types, fakeStorage().storage, clock);

    const page = await svc.getUpcomingPage();

    const ids = Array.from({ length: 8 }, (_, i) => `u${7 - i}`);
    expect(page.map((h) => h.event.id)).toEqual(ids);
    expect(page[0]).toMatchObject({
      phase: 'open',
      availableTotal: 100,
      offer: { fromPricePaisa: 50_000 },
      coverUrl: 'https://cdn.test/events/u7/cover-x.png',
    });
    // No ticket types yet: nothing to sell, no price.
    expect(page[1]).toMatchObject({ availableTotal: 0, offer: { fromPricePaisa: null } });
    expect(types.listByEvents).toHaveBeenCalledTimes(1);
    expect(types.listByEvents).toHaveBeenCalledWith(ids);
  });

  it('getArchivePage: every past event newest first with its cover, no ticket-types query', async () => {
    const { repo } = fakeRepo([
      seed('soon', 'published', new Date('2026-10-01T13:00:00Z')),
      seed('spring', 'archived', new Date('2026-03-01T13:00:00Z')),
      seed('summer', 'published', new Date('2026-07-01T13:00:00Z')),
      seed('draft-old', 'draft', new Date('2025-01-01T13:00:00Z')),
    ]);
    const types = ticketTypesOf([]);
    const svc = createEventsService(repo, types, fakeStorage().storage, clock);

    const archive = await svc.getArchivePage();

    expect(archive.map((a) => a.event.id)).toEqual(['summer', 'spring']);
    expect(archive[0]?.coverUrl).toBe('https://cdn.test/events/summer/cover-x.png');
    expect(archive[1]?.coverUrl).toBeNull();
    expect(types.listByEvents).not.toHaveBeenCalled();
  });
});

// ADR-029: a private venue never leaves the server through a public read model.
describe('eventsService — private venue', () => {
  const secret = 'Warehouse 7, Tejgaon I/A';
  const privateEvent = (id: string, startsAt: Date): EventRecord =>
    ({
      id,
      slug: id,
      title: id,
      description: null,
      venue: secret,
      venueHidden: true,
      venueArea: 'Tejgaon, Dhaka',
      startsAt,
      endsAt: null,
      registrationOpensAt: new Date('2026-01-01T00:00:00Z'),
      registrationClosesAt: new Date(startsAt.getTime() - 86_400_000),
      status: 'published',
      imageKey: null,
      presentingSponsorId: null,
      createdAt: NOW,
      updatedAt: NOW,
    }) as EventRecord;

  it('every public read strips it; the admin read keeps it', async () => {
    const { repo } = fakeRepo([
      privateEvent('soon', new Date('2026-10-01T13:00:00Z')),
      privateEvent('gone', new Date('2026-03-01T13:00:00Z')),
    ]);
    const tt: TicketTypesRepository = { ...fakeTicketTypes(), listByEvents: async () => [] };
    const svc = createEventsService(repo, tt, fakeStorage().storage, clock);

    const pub = await svc.getPublicEvent('soon');
    const home = await svc.getHomePage();
    const upcoming = await svc.getUpcomingPage();
    const archive = await svc.getArchivePage();
    for (const e of [
      pub.event,
      home.featured!.event,
      ...home.past.map((h) => h.event),
      ...upcoming.map((h) => h.event),
    ]) {
      expect(e.venue).toBeNull();
      expect(e).toMatchObject({ venueHidden: true, venueArea: 'Tejgaon, Dhaka' });
    }
    expect(upcoming).toHaveLength(1);
    expect(archive.map((a) => a.event.venue)).toEqual([null]);
    expect(JSON.stringify({ pub, home, upcoming, archive })).not.toContain('Warehouse 7');

    expect((await svc.getEvent('soon')).venue).toBe(secret);
  });

  it('stores the area only while the venue is private', async () => {
    const { repo } = fakeRepo();
    const svc = createEventsService(repo, fakeTicketTypes(), fakeStorage().storage, clock);
    const hidden = await svc.createEvent({
      title: 'Hidden',
      startsAt,
      venue: secret,
      venueHidden: true,
      venueArea: 'Tejgaon, Dhaka',
    });
    expect(hidden).toMatchObject({ venueHidden: true, venueArea: 'Tejgaon, Dhaka' });

    const shown = await svc.updateEvent(hidden.id, {
      title: 'Hidden',
      startsAt,
      venue: secret,
      venueHidden: false,
      venueArea: 'Tejgaon, Dhaka',
    });
    expect(shown).toMatchObject({ venue: secret, venueHidden: false, venueArea: null });
  });
});
