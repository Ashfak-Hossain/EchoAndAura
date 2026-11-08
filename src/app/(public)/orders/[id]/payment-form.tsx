'use client';

import { useLocale, useTranslations } from 'next-intl';
import { useActionState, useEffect, useRef, useState } from 'react';
import { Button } from '@/components/button';
import { FieldHint } from '@/components/form-field';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { formErrorText } from '@/lib/form-error-text';
import { BD_MOBILE_PREFIX } from '@/lib/validation/orders';
import type { PaymentFormState } from './actions';

interface Props {
  action: (prev: PaymentFormState, formData: FormData) => Promise<PaymentFormState>;
  /** Current values when editing an already-submitted trxID. */
  initial?: { trxId: string; senderPhone: string };
  /** "I have sent the money" (first time) or "Save transaction ID" (edit). */
  submitLabel: string;
  onSubmitted?: () => void;
}

const str = (v: unknown) => (typeof v === 'string' ? v : '');

/** A4 trxID form. Format is checked client-side-ish (on the server, inline); uniqueness is a banner. */
export function PaymentForm({ action, initial, submitLabel, onSubmitted }: Props) {
  const t = useTranslations('payment');
  const tf = useTranslations('formErrors');
  const locale = useLocale();
  const [state, formAction, pending] = useActionState(action, {});
  const errors = state.fieldErrors ?? {};
  const values = state.values ?? {};
  const [trxId, setTrxId] = useState(str(values.trxId) || initial?.trxId || '');
  const bannerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (state.banner) bannerRef.current?.focus();
  }, [state.banner]);

  const submittedRef = useRef(false);
  useEffect(() => {
    if (state.submitted && !submittedRef.current) {
      submittedRef.current = true;
      onSubmitted?.();
    }
  }, [state.submitted, onSubmitted]);

  return (
    <form action={formAction} className="flex flex-col gap-5" noValidate>
      {state.banner ? (
        <div
          ref={bannerRef}
          tabIndex={-1}
          role="alert"
          className="flex flex-col gap-1 rounded-xl border border-l-4 border-destructive/30 border-l-destructive bg-destructive-tint px-4 py-3.5 outline-none"
        >
          <p className="text-[15px] font-semibold">{t(`banner.${state.banner.code}.title`)}</p>
          <p className="text-sm leading-relaxed">{t(`banner.${state.banner.code}.body`)}</p>
        </div>
      ) : null}

      <div className="flex flex-col gap-2">
        <Label htmlFor="trxId">{t('trxLabel')}</Label>
        <Input
          id="trxId"
          name="trxId"
          autoComplete="off"
          autoCapitalize="characters"
          spellCheck={false}
          maxLength={14}
          value={trxId}
          onChange={(e) => setTrxId(e.target.value)}
          onBlur={() => setTrxId((v) => v.trim().toUpperCase())}
          aria-invalid={Boolean(errors.trxId)}
          className="h-11 bg-card font-mono text-[17px] tracking-wide tabular"
        />
        {errors.trxId ? (
          <p role="alert" className="text-sm leading-snug font-medium text-destructive">
            {formErrorText(tf, errors.trxId, locale)}
          </p>
        ) : null}
        <FieldHint>{t('trxHint')}</FieldHint>
      </div>

      <div className="flex flex-col gap-2">
        <Label htmlFor="senderPhone">{t('senderLabel')}</Label>
        <div className="flex items-stretch">
          <span className="flex items-center rounded-l-md border border-r-0 border-input bg-secondary px-3 text-[15px] text-muted-foreground tabular">
            {BD_MOBILE_PREFIX}
          </span>
          <Input
            id="senderPhone"
            name="senderPhone"
            type="tel"
            inputMode="numeric"
            autoComplete="tel-national"
            placeholder="1712345678"
            defaultValue={str(values.senderPhone) || initial?.senderPhone || ''}
            aria-invalid={Boolean(errors.senderPhone)}
            className="h-11 rounded-l-none bg-card tabular"
          />
        </div>
        {errors.senderPhone ? (
          <p role="alert" className="text-sm leading-snug font-medium text-destructive">
            {formErrorText(tf, errors.senderPhone, locale)}
          </p>
        ) : null}
      </div>

      <Button type="submit" variant="cta" size="lg" className="w-full" disabled={pending}>
        {pending ? t('saving') : submitLabel}
      </Button>
    </form>
  );
}
