'use client';

import { useRouter } from 'next/navigation';
import { useLocale, useTranslations } from 'next-intl';
import { useEffect, useState } from 'react';
import { Money } from '@/components/money';
import { PaymentForm } from './payment-form';
import type { PaymentFormState } from './actions';

interface Props {
  firstName: string;
  slaText: string;
  totalPaisa: number;
  trxId: string;
  senderMsisdn: string;
  submittedAt: string | null;
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
  contactEmail,
  action,
}: Props) {
  const t = useTranslations('order');
  const locale = useLocale();
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
        <h2 className="font-heading text-xl font-semibold">{t('checkingTitle')}</h2>
        <p className="text-sm leading-relaxed text-[#4a4640]">
          {t('checkingBody', { name: firstName, promise: slaText })}
        </p>
        <dl
          className="mt-2 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 border-t border-border pt-3 text-sm"
          data-testid="payment-summary"
        >
          <dt className="text-muted-foreground">{t('amountSent')}</dt>
          <dd className="font-medium tabular">
            <Money paisa={totalPaisa} locale={locale} />
          </dd>
          {/* The TrxID and the number stay Latin: people compare them with bKash. */}
          <dt className="text-muted-foreground">{t('trxId')}</dt>
          <dd className="font-mono font-medium tabular">{trxId}</dd>
          <dt className="text-muted-foreground">{t('sentFrom')}</dt>
          <dd className="tabular">+880 {local}</dd>
          {submittedAt ? (
            <>
              <dt className="text-muted-foreground">{t('submitted')}</dt>
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
            {t('editTrx')}
          </h2>
          <PaymentForm
            action={action}
            initial={{ trxId, senderPhone: local }}
            submitLabel={t('saveTrx')}
            onSubmitted={() => setEditing(false)}
          />
        </section>
      ) : (
        <section className="flex flex-col gap-2 rounded-xl border border-border bg-card p-4">
          <p className="text-sm leading-relaxed text-[#4a4640]">
            {t.rich('wrongDetails', {
              contact: contactEmail ? 'email' : 'none',
              address: contactEmail ?? '',
              email: (chunks) => (
                <a href={`mailto:${contactEmail}`} className="underline">
                  {chunks}
                </a>
              ),
            })}
          </p>
          <button
            type="button"
            onClick={() => setEditing(true)}
            className="self-start text-sm font-semibold underline underline-offset-2"
          >
            {t('editTrx')}
          </button>
        </section>
      )}
    </>
  );
}
