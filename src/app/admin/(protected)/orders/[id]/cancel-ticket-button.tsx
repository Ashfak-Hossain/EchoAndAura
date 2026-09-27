'use client';

import { useActionState, useId, useState } from 'react';
import { Button } from '@/components/button';
import { FormAlert } from '@/components/form-field';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { CANCEL_REASON_MAX } from '@/lib/validation/verification';
import type { VerificationActionState } from './actions';

interface Props {
  code: string;
  attendeeName: string;
  /** True when this is the order's last live ticket — the order goes with it. */
  last: boolean;
  cancel: (prev: VerificationActionState, formData: FormData) => Promise<VerificationActionState>;
}

/** B8 per-ticket Cancel: confirm with a required reason; the seat goes straight back on sale. */
export function CancelTicketButton({ code, attendeeName, last, cancel }: Props) {
  const [state, formAction, pending] = useActionState(cancel, {});
  const [open, setOpen] = useState(false);
  // The state object dismissed by closing: its error is not shown again on
  // reopen (each action returns a fresh object, so a new error still shows).
  const [dismissed, setDismissed] = useState<VerificationActionState | null>(null);
  const reasonId = useId();
  // Every way out (Escape, overlay, X, "Keep ticket") goes through here.
  const close = () => {
    setDismissed(state);
    setOpen(false);
  };

  return (
    <Dialog open={open} onOpenChange={(next) => (next ? setOpen(true) : close())}>
      <DialogTrigger
        render={<Button type="button" variant="ghost" size="sm" className="text-destructive" />}
      >
        Cancel
      </DialogTrigger>
      <DialogContent>
        <form action={formAction} className="flex flex-col gap-5">
          <DialogHeader>
            <DialogTitle>
              Cancel ticket <span className="font-mono">{code}</span>?
            </DialogTitle>
            <DialogDescription>
              The seat goes back on sale immediately and {attendeeName} will not be admitted with
              this code. Money is returned outside the app — this does not refund anything.
              {last
                ? ' It is the last live ticket on the order, so the order is cancelled too.'
                : ''}
            </DialogDescription>
          </DialogHeader>

          <div className="flex flex-col gap-2">
            <Label htmlFor={reasonId}>Reason · required</Label>
            <Textarea
              id={reasonId}
              name="reason"
              rows={3}
              required
              maxLength={CANCEL_REASON_MAX}
              placeholder="e.g. Buyer asked; refunded ৳1,200 by bKash on 21 Sep"
              className="bg-card"
            />
            <p className="text-sm text-muted-foreground">
              Kept in the audit trail — the buyer does not see it.
            </p>
          </div>

          {state.error && state !== dismissed ? <FormAlert>{state.error}</FormAlert> : null}

          <DialogFooter>
            <Button type="button" variant="secondary" onClick={close}>
              Keep ticket
            </Button>
            <Button type="submit" variant="destructive" disabled={pending}>
              {pending ? 'Cancelling…' : 'Cancel ticket'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
