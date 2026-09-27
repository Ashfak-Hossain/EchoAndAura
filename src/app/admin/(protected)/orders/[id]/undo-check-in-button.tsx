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
import { CHECK_IN_UNDO_REASON_MAX } from '@/lib/validation/door';
import type { VerificationActionState } from './actions';

interface Props {
  code: string;
  attendeeName: string;
  /** "20:51 · Gate A", as the row shows it. */
  admitted: string;
  undo: (prev: VerificationActionState, formData: FormData) => Promise<VerificationActionState>;
}

/**
 * ADR-030 (B8): take back a gate check-in — the wrong person was let in, or
 * a scan was tapped by mistake. The ticket can then be scanned again (or
 * cancelled). A reason is required: it goes in the audit trail.
 */
export function UndoCheckInButton({ code, attendeeName, admitted, undo }: Props) {
  const [state, formAction, pending] = useActionState(undo, {});
  const [open, setOpen] = useState(false);
  const [dismissed, setDismissed] = useState<VerificationActionState | null>(null);
  const reasonId = useId();
  const close = () => {
    setDismissed(state);
    setOpen(false);
  };

  return (
    <Dialog open={open} onOpenChange={(next) => (next ? setOpen(true) : close())}>
      <DialogTrigger render={<Button type="button" variant="ghost" size="sm" />}>
        Undo check-in
      </DialogTrigger>
      <DialogContent>
        <form action={formAction} className="flex flex-col gap-5">
          <DialogHeader>
            <DialogTitle>
              Undo the check-in of <span className="font-mono">{code}</span>?
            </DialogTitle>
            <DialogDescription>
              {attendeeName} was admitted at {admitted}. After this the ticket counts as not in, and
              the next scan of it admits.
            </DialogDescription>
          </DialogHeader>

          <div className="flex flex-col gap-2">
            <Label htmlFor={reasonId}>Reason · required</Label>
            <Textarea
              id={reasonId}
              name="reason"
              rows={3}
              required
              maxLength={CHECK_IN_UNDO_REASON_MAX}
              placeholder="e.g. Gate B scanned the wrong ticket of the group"
              className="bg-card"
            />
            <p className="text-sm text-muted-foreground">Kept in the audit trail.</p>
          </div>

          {state.error && state !== dismissed ? <FormAlert>{state.error}</FormAlert> : null}

          <DialogFooter>
            <Button type="button" variant="secondary" onClick={close}>
              Keep checked in
            </Button>
            <Button type="submit" disabled={pending}>
              {pending ? 'Undoing…' : 'Undo check-in'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
