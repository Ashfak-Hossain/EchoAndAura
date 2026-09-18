import { notFound } from 'next/navigation';
import { z } from 'zod';
import { eventsService } from '@/server/container';
import { EventNotFoundError } from '@/server/lib/errors';
import { toDhakaInput } from '@/lib/time';
import { updateEventAction } from '../../actions';
import { EventForm, type EventFormValues } from '../../event-form';
import { CoverSection } from '../cover/cover-section';
import { StatusSection } from '../status/status-section';
import { TicketTypesSection } from '../ticket-types/ticket-types-section';

interface Props {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ saved?: string }>;
}

// TEMPORARY DEMO MARKUP — the real admin UI is designed separately.
export default async function EditEventPage({ params, searchParams }: Props) {
  const { id } = await params;
  const { saved } = await searchParams;

  // Reject malformed ids before they reach Postgres (invalid uuid → SQL error).
  if (!z.uuid().safeParse(id).success) notFound();

  let event;
  try {
    event = await eventsService.getEvent(id);
  } catch (err: unknown) {
    if (err instanceof EventNotFoundError) notFound();
    throw err;
  }

  const defaultValues: EventFormValues = {
    title: event.title,
    slug: event.slug,
    description: event.description ?? '',
    venue: event.venue ?? '',
    startsAt: toDhakaInput(event.startsAt),
    endsAt: event.endsAt ? toDhakaInput(event.endsAt) : '',
    registrationOpensAt: event.registrationOpensAt ? toDhakaInput(event.registrationOpensAt) : '',
    registrationClosesAt: event.registrationClosesAt
      ? toDhakaInput(event.registrationClosesAt)
      : '',
  };

  return (
    <section className="flex flex-col gap-4">
      <h1 className="text-xl font-semibold">Edit event</h1>
      <EventForm
        key={event.updatedAt.toISOString()}
        action={updateEventAction.bind(null, event.id)}
        defaultValues={defaultValues}
        submitLabel="Save changes"
        saved={saved === '1'}
      />
      <hr />
      <CoverSection event={event} />
      <hr />
      <StatusSection event={event} />
      <hr />
      <TicketTypesSection eventId={event.id} />
    </section>
  );
}
