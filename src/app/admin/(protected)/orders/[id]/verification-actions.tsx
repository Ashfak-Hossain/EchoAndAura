'use client';

import { useActionState, useId, useState } from 'react';
import {
  REJECTION_NOTE_MAX,
  REJECTION_REASONS,
  REJECTION_REASON_CODES,
  type RejectionReason,
} from '@/server/lib/rejection-reasons';
import { Button } from '@/components/button';
import { FormAlert } from '@/components/form-field';
import { Money } from '@/components/money';
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
import type { VerificationActionState } from './actions';

interface Props {
  reference: string;
  buyerFirstName: string;
  buyerEmail: string;
  quantity: number;
  ticketTypeName: string;
  totalPaisa: number;
  trxId: string;
  senderMsisdn: string;
  approve: () => Promise<VerificationActionState>;
  reject: (prev: VerificationActionState, formData: FormData) => Promise<VerificationActionState>;
}

/**
 * B8 actions bar for a `pending_verification` order. Approve restates the
 * amount, trxID and sender because that trio is what Raj is checking
 * against the bKash app; Reject requires a reason from the fixed list so
 * the buyer's page and email can be written for him.
 */
export function VerificationActions(props: Props) {
  return (
    <div className="flex flex-col gap-3 rounded-xl border border-border bg-card p-4">
      <div className="flex flex-wrap items-center gap-3">
        <ApproveForm {...props} />
        <RejectForm {...props} />
      </div>
      <p className="text-sm text-muted-foreground">
        Approving issues {props.quantity} {props.quantity === 1 ? 'ticket' : 'tickets'} and emails
        them immediately. Rejecting releases the {props.quantity} held{' '}
        {props.quantity === 1 ? 'seat' : 'seats'}.
      </p>
    </div>
  );
}

function ApproveForm({ approve, totalPaisa, trxId, senderMsisdn, quantity, buyerEmail }: Props) {
  const [state, formAction, pending] = useActionState(approve, {});
  const formId = useId();
  return (
    <form id={formId} action={formAction} className="flex flex-col gap-2">
      <AlertDialog>
        <AlertDialogTrigger render={<Button type="button" variant="primary" disabled={pending} />}>
          {pending ? 'Approving…' : (
            <>
              Approve — <Money paisa={totalPaisa} />
            </>
          )}
        </AlertDialogTrigger>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Approve this payment?</AlertDialogTitle>
            <AlertDialogDescription render={<div className="flex flex-col gap-3" />}>
              <>
                <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 rounded-lg bg-info-tint px-3.5 py-3 text-sm text-foreground">
                  <dt className="text-muted-foreground">Amount</dt>
                  <dd className="tabular font-semibold">
                    <Money paisa={totalPaisa} />
                  </dd>
                  <dt className="text-muted-foreground">Transaction ID</dt>
                  <dd className="font-mono font-medium">{trxId}</dd>
                  <dt className="text-muted-foreground">Sender</dt>
                  <dd className="tabular">{senderMsisdn}</dd>
                </dl>
                <p>
                  Confirm that this credit is in your bKash statement. {quantity}{' '}
                  {quantity === 1 ? 'ticket is' : 'tickets are'} issued and emailed to{' '}
                  <strong className="text-foreground">{buyerEmail}</strong> straight away — this
                  cannot be undone, only cancelled ticket by ticket.
                </p>
              </>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction type="submit" form={formId}>
              Approve and issue tickets
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      {state.error ? <FormAlert>{state.error}</FormAlert> : null}
    </form>
  );
}

function RejectForm({ reject, reference, buyerFirstName, quantity, ticketTypeName }: Props) {
  const [state, formAction, pending] = useActionState(reject, {});
  const [reason, setReason] = useState<RejectionReason>('no_matching_credit');
  const [open, setOpen] = useState(false);
  const reasonId = useId();
  const noteId = useId();

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={<Button type="button" variant="destructive" />}>Reject</DialogTrigger>
      <DialogContent>
        <form action={formAction} className="flex flex-col gap-5">
          <DialogHeader>
            <DialogTitle>Reject {reference}?</DialogTitle>
            <DialogDescription>
              The {quantity} held {ticketTypeName} {quantity === 1 ? 'seat goes' : 'seats go'} back
              on sale and {buyerFirstName} sees the reason you choose. No tickets are issued.
            </DialogDescription>
          </DialogHeader>

          <div className="flex flex-col gap-2">
            <Label htmlFor={reasonId}>Reason · required</Label>
            <select
              id={reasonId}
              name="reason"
              value={reason}
              onChange={(e) => setReason(e.target.value as RejectionReason)}
              className="h-11 w-full rounded-md border border-input bg-card px-3 text-[15px] outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
            >
              {REJECTION_REASON_CODES.map((code) => (
                <option key={code} value={code}>
                  {REJECTION_REASONS[code]}
                </option>
              ))}
            </select>
          </div>

          <div className="flex flex-col gap-2">
            <Label htmlFor={noteId}>Note to the buyer · optional</Label>
            <Textarea id={noteId} name="note" rows={3} maxLength={REJECTION_NOTE_MAX} className="bg-card" />
            <p className="text-sm text-muted-foreground">
              This text is shown on the buyer&apos;s order page and in the email, word for word.
            </p>
          </div>

          {state.error ? <FormAlert>{state.error}</FormAlert> : null}

          <DialogFooter>
            <Button type="button" variant="secondary" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button type="submit" variant="destructive" disabled={pending}>
              {pending ? 'Rejecting…' : 'Reject order'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
