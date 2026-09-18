'use client';

import { useActionState, useId } from 'react';
import { FormAlert } from '@/components/form-field';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';
import type { StatusActionState } from './actions';

export interface StatusButton {
  /** Target status; doubles as the stable key. */
  to: string;
  label: string;
  action: () => Promise<StatusActionState>;
  /** Rendered disabled with `reason` when the move is known to be blocked. */
  disabledReason?: string;
  /** One line under the button explaining the consequence (B5). */
  hint?: string;
  /** Ask first — Archive ends the event for good. */
  confirm?: { title: string; description: string; confirmLabel: string };
  destructive?: boolean;
}

// B5 Publish tab actions. Buttons come from the state machine, so only legal
// moves are ever rendered; the readiness check disables Publish with reasons.
export function StatusButtons({ buttons }: { buttons: StatusButton[] }) {
  return (
    <div className="flex flex-col gap-4">
      {buttons.map((b) => (
        <StatusForm key={b.to} button={b} />
      ))}
    </div>
  );
}

function StatusForm({ button }: { button: StatusButton }) {
  const [state, formAction, pending] = useActionState(button.action, {});
  // The confirm dialog is portaled outside the <form>; `form={formId}` ties
  // its submit button back to it.
  const formId = useId();
  const disabled = pending || button.disabledReason !== undefined;
  const variant = button.destructive
    ? 'destructive'
    : button.to === 'published'
      ? 'default'
      : 'outline';

  const submit = (
    <Button type="submit" variant={variant} disabled={disabled} title={button.disabledReason}>
      {pending ? 'Working…' : button.label}
    </Button>
  );

  return (
    <form id={formId} action={formAction} className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-3">
        {button.confirm && !disabled ? (
          <AlertDialog>
            <AlertDialogTrigger render={<Button type="button" variant={variant} />}>
              {button.label}
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>{button.confirm.title}</AlertDialogTitle>
                <AlertDialogDescription>{button.confirm.description}</AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Keep as is</AlertDialogCancel>
                <AlertDialogAction type="submit" form={formId} variant="destructive">
                  {button.confirm.confirmLabel}
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        ) : (
          submit
        )}
        {button.hint ? <span className="text-sm text-muted-foreground">{button.hint}</span> : null}
      </div>
      {state.error ? <FormAlert>{state.error}</FormAlert> : null}
    </form>
  );
}
