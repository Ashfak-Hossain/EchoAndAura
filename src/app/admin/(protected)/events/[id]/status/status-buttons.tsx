'use client';

import { useActionState } from 'react';
import type { StatusActionState } from './actions';

export interface StatusButton {
  /** Target status; doubles as the stable key. */
  to: string;
  label: string;
  action: () => Promise<StatusActionState>;
  /** Rendered disabled with `reason` when the move is known to be blocked. */
  disabledReason?: string;
  destructive?: boolean;
}

// TEMPORARY DEMO MARKUP — the real UI (confirm dialogs) is designed separately.
export function StatusButtons({ buttons }: { buttons: StatusButton[] }) {
  return (
    <div className="flex flex-wrap items-start gap-3">
      {buttons.map((b) => (
        <StatusForm key={b.to} button={b} />
      ))}
    </div>
  );
}

function StatusForm({ button }: { button: StatusButton }) {
  const [state, formAction, pending] = useActionState(button.action, {});
  const disabled = pending || button.disabledReason !== undefined;

  return (
    <form action={formAction} className="flex flex-col gap-1">
      <button
        type="submit"
        disabled={disabled}
        title={button.disabledReason}
        className={
          button.destructive
            ? 'rounded border border-red-600 px-3 py-2 text-sm text-red-600 disabled:opacity-50'
            : 'rounded bg-black px-3 py-2 text-sm text-white disabled:opacity-50'
        }
      >
        {pending ? 'Working…' : button.label}
      </button>
      {state.error ? (
        <p role="alert" className="max-w-xs text-sm text-red-600">
          {state.error}
        </p>
      ) : null}
    </form>
  );
}
