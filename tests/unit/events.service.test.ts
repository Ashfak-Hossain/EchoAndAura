import { describe, expect, it } from 'vitest';
import { EventNotFoundError, EventSlugTakenError } from '@/server/lib/errors';
import type {
  EventPatch,
  EventRecord,
  EventsRepository,
  NewEvent,
} from '@/server/repositories/events.repository';
import { createEventsService } from '@/server/services/events.service';

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
    imageUrl: values.imageUrl ?? null,
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
  };
  return { repo, rows };
}

const startsAt = new Date('2026-10-01T13:00:00Z');

describe('eventsService.createEvent', () => {
  it('derives the slug from the title and fills the default registration window', async () => {
    const { repo } = fakeRepo();
    const svc = createEventsService(repo);

    const event = await svc.createEvent({ title: 'Launch Night 2026', startsAt });

    expect(event.slug).toBe('launch-night-2026');
    expect(event.status).toBe('draft');
    expect(event.registrationOpensAt?.toISOString()).toBe('2026-09-11T13:00:00.000Z');
    expect(event.registrationClosesAt?.toISOString()).toBe('2026-09-26T13:00:00.000Z');
  });

  it('respects an explicit slug and explicit registration window', async () => {
    const svc = createEventsService(fakeRepo().repo);
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
    const svc = createEventsService(fakeRepo().repo);
    const closes = new Date('2026-09-30T00:00:00Z');

    const event = await svc.createEvent({ title: 'X', startsAt, registrationClosesAt: closes });

    expect(event.registrationOpensAt?.toISOString()).toBe('2026-09-11T13:00:00.000Z');
    expect(event.registrationClosesAt).toEqual(closes);
  });

  // Failure path: uniqueness is the repository/DB's job; the service must let
  // the typed error through untouched so the action can name the field.
  it('surfaces EventSlugTakenError on a duplicate slug', async () => {
    const svc = createEventsService(fakeRepo().repo);
    await svc.createEvent({ title: 'Same Title', startsAt });

    await expect(svc.createEvent({ title: 'Same Title', startsAt })).rejects.toBeInstanceOf(
      EventSlugTakenError,
    );
  });
});

describe('eventsService.updateEvent / getEvent', () => {
  it('throws EventNotFoundError for an unknown id', async () => {
    const svc = createEventsService(fakeRepo().repo);
    await expect(svc.getEvent('missing')).rejects.toBeInstanceOf(EventNotFoundError);
    await expect(svc.updateEvent('missing', { title: 'X', startsAt })).rejects.toBeInstanceOf(
      EventNotFoundError,
    );
  });

  it('replaces the editable fields and re-derives blanks', async () => {
    const { repo, rows } = fakeRepo();
    const svc = createEventsService(repo);
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
    const svc = createEventsService(fakeRepo().repo);
    await svc.createEvent({ title: 'First', startsAt });
    const second = await svc.createEvent({ title: 'Second', startsAt });

    await expect(
      svc.updateEvent(second.id, { title: 'Second', slug: 'first', startsAt }),
    ).rejects.toBeInstanceOf(EventSlugTakenError);
  });
});
