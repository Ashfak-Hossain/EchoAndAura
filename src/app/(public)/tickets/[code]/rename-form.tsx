'use client';

import { useActionState, useState } from 'react';
import { Button } from '@/components/button';
import { FieldHint } from '@/components/form-field';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import type { RenameState } from './actions';

interface Props {
  action: (prev: RenameState, formData: FormData) => Promise<RenameState>;
  currentName: string;
  /** "Sat 26 Sep 2026, 23:59 (Dhaka)" — when names lock. */
  lockedAtText: string | null;
}

/**
 * A5 name edit: inline inside the ticket, not a dialog — the buyer is
 * comparing the name to the card in front of them. The code never changes.
 */
export function RenameForm({ action, currentName, lockedAtText }: Props) {
  const [state, formAction, pending] = useActionState(action, {});
  // Derived, not synced: a successful save closes the form by itself; the
  // buyer can reopen it, at which point the last save is no longer "new".
  const [openedAfter, setOpenedAfter] = useState<number | null | undefined>(undefined);
  const open = openedAfter !== undefined && openedAfter === (state.savedAt ?? null);
  const announced = state.saved ?? null;

  if (!open) {
    return (
      <div className="flex flex-col gap-2">
        {announced ? (
          <p role="status" className="rounded-md bg-success-tint px-3 py-2 text-sm text-success">
            Name updated to {announced}.
          </p>
        ) : null}
        <button
          type="button"
          onClick={() => setOpenedAfter(state.savedAt ?? null)}
          className="self-start text-sm font-semibold underline underline-offset-2"
        >
          Edit name
        </button>
      </div>
    );
  }

  return (
    <form action={formAction} className="flex flex-col gap-3 rounded-xl border border-border-strong bg-card p-4" noValidate>
      <div className="flex flex-col gap-2">
        <Label htmlFor="attendeeName">Name on this ticket</Label>
        <Input
          id="attendeeName"
          name="attendeeName"
          defaultValue={state.saved ?? currentName}
          autoComplete="off"
          autoFocus
          aria-invalid={Boolean(state.error)}
          className="h-11 bg-card"
        />
        {state.error ? (
          <p role="alert" className="text-sm leading-snug font-medium text-destructive">
            {state.error}
          </p>
        ) : (
          <FieldHint>
            Use the name the guest will give at the door.
            {lockedAtText ? ` Changeable until ${lockedAtText}.` : ''}
          </FieldHint>
        )}
      </div>
      <div className="flex gap-2">
        <Button type="submit" size="sm" disabled={pending}>
          {pending ? 'Saving…' : 'Save name'}
        </Button>
        <Button type="button" size="sm" variant="secondary" onClick={() => setOpenedAfter(undefined)}>
          Cancel
        </Button>
      </div>
      <p className="text-[13px] text-muted-foreground">The code never changes when you rename a ticket.</p>
    </form>
  );
}
