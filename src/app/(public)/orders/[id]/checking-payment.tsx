'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { Money } from '@/components/money';
import { Countdown } from './countdown';
import { PaymentForm } from './payment-form';
import type { PaymentFormState } from './actions';

interface Props {
  firstName: string;
  slaText: string;
  totalPaisa: number;
  trxId: string;
  senderMsisdn: string;
  submittedAt: string | null;
  holdExpiresAt: string | null;
  contactEmail: string | null;
  action: (prev: PaymentFormState, formData: FormData) => Promise<PaymentFormState>;
}

/** A4 "Checking your payment": what was submitted, and an Edit that reopens the form. */
export function CheckingPayment({
  firstName,
  slaText,
  totalPaisa,
  trxId,
  senderMsisdn,
  submittedAt,
  holdExpiresAt,
  contactEmail,
  action,
}: Props) {
  const [editing, setEditing] = useState(false);
  const local = senderMsisdn.replace(/^\+880/, '');

  // "This page updates itself": a person changes the status, not the buyer.
  // Paused while the edit form is open so a refresh never wipes typing.
  const router = useRouter();
  useEffect(() => {
    if (editing) return;
    const id = setInterval(() => router.refresh(), 60_000);
    return () => clearInterval(id);
  }, [editing, router]);

  return (
    <>
      <section className="flex flex-col gap-2 rounded-xl border border-border bg-card p-4 lg:p-5">
        <h2 className="font-heading text-xl font-semibold">Checking your payment</h2>
        <p className="text-sm leading-relaxed text-[#4a4640]">
          Thanks, {firstName}. We have your transaction ID and a person is matching it against the
          bKash statement — {slaText}. You will get an email either way, and this page updates
          itself.
        </p>
        <dl
          className="mt-2 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 border-t border-border pt-3 text-sm"
          data-testid="payment-summary"
        >
          <dt className="text-muted-foreground">Amount sent</dt>
          <dd className="font-medium tabular">
            <Money paisa={totalPaisa} />
          </dd>
          <dt className="text-muted-foreground">Transaction ID</dt>
          <dd className="font-mono font-medium tabular">{trxId}</dd>
          <dt className="text-muted-foreground">Sent from</dt>
          <dd className="tabular">+880 {local}</dd>
          {submittedAt ? (
            <>
              <dt className="text-muted-foreground">Submitted</dt>
              <dd className="tabular">{submittedAt}</dd>
            </>
          ) : null}
        </dl>
      </section>

      {editing ? (
        <section
          aria-labelledby="edit-heading"
          className="flex flex-col gap-4 rounded-xl border border-border-strong bg-card p-4 lg:p-5"
        >
          <h2 id="edit-heading" className="font-heading text-lg font-semibold">
            Edit transaction ID
          </h2>
          <PaymentForm
            action={action}
            initial={{ trxId, senderPhone: local }}
            submitLabel="Save transaction ID"
            onSubmitted={() => setEditing(false)}
          />
        </section>
      ) : (
        <section className="flex flex-col gap-2 rounded-xl border border-border bg-card p-4">
          <p className="text-sm leading-relaxed text-[#4a4640]">
            Sent the wrong amount or the wrong reference? Edit the transaction ID, or message the
            organizer
            {contactEmail ? (
              <>
                {' '}
                at{' '}
                <a href={`mailto:${contactEmail}`} className="underline">
                  {contactEmail}
                </a>
              </>
            ) : null}
            {holdExpiresAt ? (
              <>
                {' '}
                before the hold expires (<Countdown until={holdExpiresAt} /> left)
              </>
            ) : null}
            .
          </p>
          <button
            type="button"
            onClick={() => setEditing(true)}
            className="self-start text-sm font-semibold underline underline-offset-2"
          >
            Edit transaction ID
          </button>
        </section>
      )}
    </>
  );
}
