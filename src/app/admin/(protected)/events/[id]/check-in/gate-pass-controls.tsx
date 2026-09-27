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
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { CHECK_IN_UNDO_REASON_MAX } from '@/lib/validation/door';
import type { GatePassActionState } from './actions';

type FormAction = (prev: GatePassActionState, formData: FormData) => Promise<GatePassActionState>;

/** "New gate pass": one field, the gate's name as staff will see it. */
export function NewGatePassForm({ create }: { create: FormAction }) {
  const [state, formAction, pending] = useActionState(create, {});
  const labelId = useId();
  return (
    <form action={formAction} className="flex flex-col gap-2">
      <Label htmlFor={labelId}>Gate name</Label>
      <div className="flex flex-wrap gap-2">
        <Input
          id={labelId}
          name="label"
          required
          maxLength={40}
          placeholder="e.g. Gate A, VIP door"
          className="h-9 w-56 bg-card"
        />
        <Button type="submit" size="sm" disabled={pending}>
          {pending ? 'Creating…' : 'New gate pass'}
        </Button>
      </div>
      {state.error ? <FormAlert>{state.error}</FormAlert> : null}
    </form>
  );
}

/** Revoke: the phone holding this pass stops working at its next request. */
export function RevokeGatePassButton({
  label,
  revoke,
}: {
  label: string;
  revoke: () => Promise<GatePassActionState>;
}) {
  const [state, formAction, pending] = useActionState(revoke, {});
  const [open, setOpen] = useState(false);
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={<Button type="button" variant="ghost" size="sm" />}>
        Revoke
      </DialogTrigger>
      <DialogContent>
        <form action={formAction} className="flex flex-col gap-5">
          <DialogHeader>
            <DialogTitle>Revoke the pass for {label}?</DialogTitle>
            <DialogDescription>
              The phone using it stops scanning straight away. Everyone it already let in stays
              checked in. You can make a new pass for the gate at any time.
            </DialogDescription>
          </DialogHeader>
          {state.error ? <FormAlert>{state.error}</FormAlert> : null}
          <DialogFooter>
            <Button type="button" variant="secondary" onClick={() => setOpen(false)}>
              Keep it
            </Button>
            <Button type="submit" variant="destructive" disabled={pending}>
              {pending ? 'Revoking…' : 'Revoke pass'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/** For a leaked pass: revoke it and take back every check-in it made. */
export function RevokeAndUndoButton({
  label,
  admitted,
  revokeAndUndo,
}: {
  label: string;
  admitted: number;
  revokeAndUndo: FormAction;
}) {
  const [state, formAction, pending] = useActionState(revokeAndUndo, {});
  const [open, setOpen] = useState(false);
  const reasonId = useId();
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger
        render={<Button type="button" variant="ghost" size="sm" className="text-destructive" />}
      >
        Revoke and undo its check-ins
      </DialogTrigger>
      <DialogContent>
        <form action={formAction} className="flex flex-col gap-5">
          <DialogHeader>
            <DialogTitle>Revoke {label} and undo its check-ins?</DialogTitle>
            <DialogDescription>
              For a pass that got into the wrong hands. It stops working, and the tickets it
              admitted that are still checked in ({admitted} admitted in total) go back to “not in”
              — their real holders can then be scanned in.
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
              placeholder="e.g. Pass link was posted in a public group"
              className="bg-card"
            />
          </div>
          {state.error ? <FormAlert>{state.error}</FormAlert> : null}
          <DialogFooter>
            <Button type="button" variant="secondary" onClick={() => setOpen(false)}>
              Keep it
            </Button>
            <Button type="submit" variant="destructive" disabled={pending}>
              {pending ? 'Working…' : 'Revoke and undo'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
