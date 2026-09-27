'use client';

import { useRouter } from 'next/navigation';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import type { CompFormState } from './comp-actions';
import { type CompTicketTypeOption, CompTicketsForm } from './comp-tickets-form';

/**
 * B13, driven by the URL (`?tab=ticket-types&comp=<ticketTypeId>` or
 * `comp=1`), so back and refresh land on the same thing. Closing returns
 * to the Ticket types tab.
 */
export function CompTicketsSheet({
  closeHref,
  eventTitle,
  action,
  ticketTypes,
  initialTicketTypeId,
}: {
  closeHref: string;
  eventTitle: string;
  action: (prev: CompFormState, formData: FormData) => Promise<CompFormState>;
  ticketTypes: CompTicketTypeOption[];
  initialTicketTypeId: string | null;
}) {
  const router = useRouter();
  const close = () => router.replace(closeHref, { scroll: false });

  return (
    <Sheet open onOpenChange={(open) => (open ? undefined : close())}>
      <SheetContent side="right" className="w-full gap-0 p-0 sm:max-w-md">
        <SheetHeader className="px-6 pt-6 pb-4">
          <SheetTitle className="text-xl">Issue complimentary tickets</SheetTitle>
          <SheetDescription>{eventTitle}</SheetDescription>
        </SheetHeader>
        <CompTicketsForm
          action={action}
          ticketTypes={ticketTypes}
          initialTicketTypeId={initialTicketTypeId}
          onDone={close}
        />
      </SheetContent>
    </Sheet>
  );
}
