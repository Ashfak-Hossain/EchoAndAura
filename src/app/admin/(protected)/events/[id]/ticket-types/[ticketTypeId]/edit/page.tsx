import Link from 'next/link';
import { notFound } from 'next/navigation';
import { z } from 'zod';
import { ticketTypesService } from '@/server/container';
import { TicketTypeNotFoundError } from '@/server/lib/errors';
import { paisaToTaka } from '@/server/lib/money';
import { toDhakaInput } from '@/lib/time';
import { deleteTicketTypeAction, updateTicketTypeAction } from '../../actions';
import { TicketTypeForm, type TicketTypeFormValues } from '../../ticket-type-form';
import { DeleteTicketTypeButton } from './delete-button';

interface Props {
  params: Promise<{ id: string; ticketTypeId: string }>;
}

// TEMPORARY DEMO MARKUP — the real admin UI is designed separately.
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
  const inUse = ticketType.quantitySold > 0 || ticketType.quantityReserved > 0;

  return (
    <section className="flex flex-col gap-4">
      <p className="text-sm">
        <Link href={`/admin/events/${eventId}/edit`} className="underline">
          ← Back to event
        </Link>
      </p>
      <h1 className="text-xl font-semibold">Edit ticket type</h1>
      <p className="text-sm text-neutral-600">
        Sold {ticketType.quantitySold} · Held {ticketType.quantityReserved} · Available{' '}
        {ticketType.quantityTotal - ticketType.quantitySold - ticketType.quantityReserved}
      </p>
      <TicketTypeForm
        key={ticketType.updatedAt.toISOString()}
        action={updateTicketTypeAction.bind(null, eventId, ticketType.id)}
        defaultValues={defaultValues}
        submitLabel="Save changes"
      />
      <hr />
      <DeleteTicketTypeButton
        action={deleteTicketTypeAction.bind(null, eventId, ticketType.id)}
        inUse={inUse}
      />
    </section>
  );
}
