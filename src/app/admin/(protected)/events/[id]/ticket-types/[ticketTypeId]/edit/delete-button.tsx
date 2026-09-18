'use client';

import { useActionState } from 'react';
import type { TicketTypeFormState } from '../../actions';

interface Props {
  action: () => Promise<TicketTypeFormState>;
  /** Sold or held tickets exist — deletion is refused server-side too. */
  inUse: boolean;
}

// TEMPORARY DEMO MARKUP — the real UI (confirm dialog) is designed separately.
export function DeleteTicketTypeButton({ action, inUse }: Props) {
  const [state, formAction, pending] = useActionState(action, {});

  return (
    <form action={formAction} className="flex flex-col gap-2">
      <button
        type="submit"
        disabled={pending || inUse}
        className="self-start rounded border border-red-600 px-3 py-2 text-sm text-red-600 disabled:opacity-50"
      >
        {pending ? 'Deleting…' : 'Delete ticket type'}
      </button>
      {inUse ? (
        <p className="text-xs text-neutral-600">
          Cannot delete: tickets have been sold or are on hold.
        </p>
      ) : null}
      {state.error ? (
        <p role="alert" className="text-sm text-red-600">
          {state.error}
        </p>
      ) : null}
    </form>
  );
}
