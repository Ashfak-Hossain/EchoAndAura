import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { z } from 'zod';
import { eventsService, ticketTypesService } from '@/server/container';
import { descriptionToHtml } from '@/server/lib/description';
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
import { DatesInPlainWords } from '../dates-in-plain-words';
import { StatusSection } from '../status/status-section';
import { issueComplimentaryTicketsAction } from '../ticket-types/comp-actions';
import { CompTicketsSheet } from '../ticket-types/comp-tickets-sheet';
import { TicketTypesSection } from '../ticket-types/ticket-types-section';

export const metadata: Metadata = { title: 'Edit event' };

interface Props {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ saved?: string; tab?: string; comp?: string; comped?: string }>;
}

// B5: the event hub. Tabs are URL state (?tab=), server-rendered, so each
// section only loads what it needs and every view is deep-linkable.
export default async function EditEventPage({ params, searchParams }: Props) {
  const { id } = await params;
  const { saved, tab: rawTab, comp, comped } = await searchParams;
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

  // B13 sheet over the Ticket types tab: `comp=<ticketTypeId>` preselects
  // that row's type, `comp=1` the first with stock. Anything else is ignored.
  const compOpen = tab === 'ticket-types' && comp !== undefined && ticketTypes.length > 0;
  const compPreselect = ticketTypes.some((t) => t.id === comp) ? comp! : null;
  const compedOrder = comped && z.uuid().safeParse(comped).success ? comped : null;

  const defaultValues: EventFormValues = {
    title: event.title,
    slug: event.slug,
    // Legacy plain-text rows become paragraphs so the editor shows them as is.
    description: descriptionToHtml(event.description) ?? '',
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
          event.status === 'draft' ? undefined : (
            <>
              {/* The door list stays reachable after archiving (design B5). */}
              <ButtonLink variant="secondary" href={`/admin/events/${event.id}/check-in`}>
                Check-in list
              </ButtonLink>
              {event.status === 'published' ? (
                <ButtonLink
                  variant="secondary"
                  href={`/events/${event.slug}`}
                  target="_blank"
                  rel="noreferrer"
                >
                  View public page ↗
                </ButtonLink>
              ) : null}
            </>
          )
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
        // The form takes the full content width beside the 320px panel — no
        // caps: an inner max-width left a dead band, an outer one left the
        // right edge empty. The shell's own 1440 limit is the only bound.
        <div className="grid items-start gap-8 lg:grid-cols-[minmax(0,1fr)_320px]">
          <EventForm
            key={event.updatedAt.toISOString()}
            action={updateEventAction.bind(null, event.id)}
            defaultValues={defaultValues}
            submitLabel="Save changes"
            saved={saved === '1'}
            publicUrl={`/events/${event.slug}`}
          />
          <DatesInPlainWords event={event} />
        </div>
      ) : null}
      {tab === 'cover' ? <CoverSection event={event} /> : null}
      {tab === 'ticket-types' && compedOrder ? (
        <p
          role="status"
          className="rounded-md bg-success-tint px-3 py-2 text-sm text-success"
          data-testid="comp-issued"
        >
          Complimentary tickets issued — the tickets email is on its way.{' '}
          <Link href={`/admin/orders/${compedOrder}`} className="font-medium underline">
            View order
          </Link>
        </p>
      ) : null}
      {tab === 'ticket-types' ? (
        <TicketTypesSection eventId={event.id} ticketTypes={ticketTypes} />
      ) : null}
      {compOpen ? (
        <CompTicketsSheet
          closeHref={editorPath(event.id, 'ticket-types')}
          eventTitle={event.title}
          action={issueComplimentaryTicketsAction.bind(null, event.id)}
          ticketTypes={ticketTypes.map((t) => ({
            id: t.id,
            name: t.name,
            pricePaisa: t.pricePaisa,
            available: Math.max(0, t.quantityTotal - t.quantitySold - t.quantityReserved),
          }))}
          initialTicketTypeId={compPreselect}
        />
      ) : null}
      {tab === 'publish' ? <StatusSection event={event} /> : null}
    </div>
  );
}
