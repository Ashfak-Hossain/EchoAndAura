import { notFound } from 'next/navigation';
import { z } from 'zod';
import { eventsService } from '@/server/container';
import { EventNotFoundError } from '@/server/lib/errors';
import { PageHeader } from '@/components/page-header';
import { editorPath } from '../../editor-path';
import { createTicketTypeAction } from '../actions';
import { TicketTypeForm } from '../ticket-type-form';

interface Props {
  params: Promise<{ id: string }>;
}

// B6 add form (page; the design's sheet is a later polish).
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

  const backHref = editorPath(event.id, 'ticket-types');

  return (
    <div className="flex flex-col gap-6">
      <PageHeader title="New ticket type" subtitle={event.title} />
      <TicketTypeForm
        action={createTicketTypeAction.bind(null, event.id)}
        submitLabel="Add ticket type"
        cancelHref={backHref}
      />
    </div>
  );
}
