import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { z } from 'zod';
import { eventsService, ticketTypesService } from '@/server/container';
import { EventNotFoundError } from '@/server/lib/errors';
import { ButtonLink } from '@/components/button-link';
import { PageHeader } from '@/components/page-header';
import { StatusChip } from '@/components/status-chip';
import { TabNav } from '@/components/tab-nav';
import { formatDhakaLong, toDhakaInput } from '@/lib/time';
import { type EditorTab, editorPath, isEditorTab } from '../editor-path';
import { updateEventAction } from '../../actions';
import { EventForm, type EventFormValues } from '../../event-form';
import { CoverSection } from '../cover/cover-section';
import { StatusSection } from '../status/status-section';
import { TicketTypesSection } from '../ticket-types/ticket-types-section';

export const metadata: Metadata = { title: 'Edit event' };

interface Props {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ saved?: string; tab?: string }>;
}

// B5: the event hub. Tabs are URL state (?tab=), server-rendered, so each
// section only loads what it needs and every view is deep-linkable.
export default async function EditEventPage({ params, searchParams }: Props) {
  const { id } = await params;
  const { saved, tab: rawTab } = await searchParams;
  const tab: EditorTab = isEditorTab(rawTab) ? rawTab : 'details';

  // Reject malformed ids before they reach Postgres (invalid uuid → SQL error).
  if (!z.uuid().safeParse(id).success) notFound();

  let event;
  try {
    event = await eventsService.getEvent(id);
  } catch (err: unknown) {
    if (err instanceof EventNotFoundError) notFound();
    throw err;
  }

  const ticketTypes = await ticketTypesService.listForEvent(event.id);
  const sold = ticketTypes.reduce((n, t) => n + t.quantitySold, 0);
  const total = ticketTypes.reduce((n, t) => n + t.quantityTotal, 0);

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
    <div className="flex flex-col gap-6">
      <PageHeader
        title={event.title}
        badge={<StatusChip status={event.status} />}
        subtitle={`${formatDhakaLong(event.startsAt)} (Dhaka) · ${sold} of ${total} sold`}
        actions={
          event.status === 'published' ? (
            <ButtonLink
              variant="outline"
              href={`/events/${event.slug}`}
              target="_blank"
              rel="noreferrer"
            >
              View public page ↗
            </ButtonLink>
          ) : undefined
        }
      />

      <TabNav
        label="Event sections"
        active={tab}
        items={[
          { key: 'details', label: 'Details', href: editorPath(event.id) },
          {
            key: 'cover',
            label: 'Cover image',
            href: editorPath(event.id, 'cover'),
          },
          {
            key: 'ticket-types',
            label: 'Ticket types',
            href: editorPath(event.id, 'ticket-types'),
            count: ticketTypes.length,
          },
          {
            key: 'publish',
            label: 'Publish',
            href: editorPath(event.id, 'publish'),
          },
        ]}
      />

      {tab === 'details' ? (
        <EventForm
          key={event.updatedAt.toISOString()}
          action={updateEventAction.bind(null, event.id)}
          defaultValues={defaultValues}
          submitLabel="Save changes"
          saved={saved === '1'}
          publicUrl={`/events/${event.slug}`}
        />
      ) : null}
      {tab === 'cover' ? <CoverSection event={event} /> : null}
      {tab === 'ticket-types' ? (
        <TicketTypesSection eventId={event.id} ticketTypes={ticketTypes} />
      ) : null}
      {tab === 'publish' ? <StatusSection event={event} /> : null}
    </div>
  );
}
