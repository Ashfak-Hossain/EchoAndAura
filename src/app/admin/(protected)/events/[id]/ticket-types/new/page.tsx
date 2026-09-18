import Link from 'next/link';
import { notFound } from 'next/navigation';
import { z } from 'zod';
import { eventsService } from '@/server/container';
import { EventNotFoundError } from '@/server/lib/errors';
import { createTicketTypeAction } from '../actions';
import { TicketTypeForm } from '../ticket-type-form';

interface Props {
  params: Promise<{ id: string }>;
}

// TEMPORARY DEMO MARKUP — the real admin UI is designed separately.
export default async function NewTicketTypePage({ params }: Props) {
  const { id } = await params;
  if (!z.uuid().safeParse(id).success) notFound();

  let event;
  try {
    event = await eventsService.getEvent(id);
  } catch (err: unknown) {
    if (err instanceof EventNotFoundError) notFound();
    throw err;
  }

  return (
    <section className="flex flex-col gap-4">
      <p className="text-sm">
        <Link href={`/admin/events/${event.id}/edit`} className="underline">
          ← {event.title}
        </Link>
      </p>
      <h1 className="text-xl font-semibold">New ticket type</h1>
      <TicketTypeForm
        action={createTicketTypeAction.bind(null, event.id)}
        submitLabel="Add ticket type"
      />
    </section>
  );
}
