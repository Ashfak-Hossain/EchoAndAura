import { notFound } from 'next/navigation';
import { z } from 'zod';
import { ticketTypesService } from '@/server/container';
import { TicketTypeNotFoundError } from '@/server/lib/errors';
import { paisaToTaka } from '@/server/lib/money';
import { PageHeader } from '@/components/page-header';
import { toDhakaInput } from '@/lib/time';
import { editorPath } from '../../../editor-path';
import { deleteTicketTypeAction, updateTicketTypeAction } from '../../actions';
import { TicketTypeForm, type TicketTypeFormValues } from '../../ticket-type-form';
import { DeleteTicketTypeButton } from './delete-button';

interface Props {
  params: Promise<{ id: string; ticketTypeId: string }>;
}

// B6 edit form (page; the design's sheet is a later polish).
export default async function EditTicketTypePage({ params }: Props) {
  const { id: eventId, ticketTypeId } = await params;
  if (!z.uuid().safeParse(eventId).success || !z.uuid().safeParse(ticketTypeId).success) {
    notFound();
  }

  let ticketType;
  try {
    ticketType = await ticketTypesService.getTicketType(ticketTypeId);
  } catch (err: unknown) {
    if (err instanceof TicketTypeNotFoundError) notFound();
    throw err;
  }
  // A ticket type is only reachable under its own event's URL.
  if (ticketType.eventId !== eventId) notFound();

  const defaultValues: TicketTypeFormValues = {
    name: ticketType.name,
    priceTaka: paisaToTaka(ticketType.pricePaisa).toFixed(2),
    quantityTotal: String(ticketType.quantityTotal),
    salesStartsAt: ticketType.salesStartsAt ? toDhakaInput(ticketType.salesStartsAt) : '',
    salesEndsAt: ticketType.salesEndsAt ? toDhakaInput(ticketType.salesEndsAt) : '',
  };
  const committed = ticketType.quantitySold + ticketType.quantityReserved;
  const inUse = committed > 0;
  const backHref = editorPath(eventId, 'ticket-types');

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Edit ticket type"
        subtitle={`${ticketType.name} · ${ticketType.quantitySold} sold, ${ticketType.quantityReserved} held, ${
          ticketType.quantityTotal - committed
        } available`}
      />
      <TicketTypeForm
        key={ticketType.updatedAt.toISOString()}
        action={updateTicketTypeAction.bind(null, eventId, ticketType.id)}
        defaultValues={defaultValues}
        submitLabel="Save changes"
        committed={committed}
        cancelHref={backHref}
      />
      <DeleteTicketTypeButton
        action={deleteTicketTypeAction.bind(null, eventId, ticketType.id)}
        inUse={inUse}
      />
    </div>
  );
}
