'use client';

import { useActionState } from 'react';
import { FormAlert } from '@/components/form-field';
import { Button } from '@/components/button';
import type { TicketTypeFormState } from '../../actions';

interface Props {
  action: () => Promise<TicketTypeFormState>;
  /** Sold or held tickets exist — deletion is refused server-side too. */
  inUse: boolean;
}

// B6: destructive, explained. A confirm dialog joins in the sheet polish.
export function DeleteTicketTypeButton({ action, inUse }: Props) {
  const [state, formAction, pending] = useActionState(action, {});

  return (
    <form
      action={formAction}
      className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border px-6 py-4"
    >
      <div className="flex flex-col gap-1 text-sm">
        <span className="font-medium">Delete this ticket type</span>
        <span className="text-muted-foreground">
          {inUse
            ? 'Cannot delete: tickets have been sold or are on hold. Close sales with an end date instead.'
            : 'Only possible while nothing has been sold or held.'}
        </span>
      </div>
      <Button type="submit" variant="destructive" disabled={pending || inUse}>
        {pending ? 'Deleting…' : 'Delete ticket type'}
      </Button>
      {state.error ? (
        <div className="basis-full">
          <FormAlert>{state.error}</FormAlert>
        </div>
      ) : null}
    </form>
  );
}
