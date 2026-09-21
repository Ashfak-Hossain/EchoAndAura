'use client';

import { useActionState } from 'react';
import type { ReactNode } from 'react';
import { Button } from '@/components/button';
import { Field, FormAlert, FormSuccess } from '@/components/form-field';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { cn } from '@/lib/utils';
import {
  ACCOUNT_NAME_MAX,
  ORGANIZER_ADDRESS_MAX,
  ORGANIZER_NAME_MAX,
  VERIFICATION_PROMISE_MAX,
} from '@/lib/validation/settings';
import type { SettingsFormState, SettingsFormValues } from './actions';

interface Props {
  action: (prev: SettingsFormState, formData: FormData) => Promise<SettingsFormState>;
  /** The effective values (saved or fallback), as the form shows them. */
  defaultValues: SettingsFormValues;
  saved: boolean;
}

/**
 * B14. Every field here is quoted somewhere the buyer can see, so each
 * helper names where it shows up. Three cards: bKash (tinted like B8's bKash
 * block), support, wording. One Save for the lot — the row is saved whole.
 */
export function SettingsForm({ action, defaultValues, saved }: Props) {
  const [state, formAction, pending] = useActionState(action, {});
  // React resets uncontrolled inputs after an action; re-seed from the last
  // submission so a validation error never wipes the organizer's input.
  const values = state.values ?? defaultValues;
  const invalid = (field: keyof SettingsFormValues) =>
    state.field === field ? 'border-destructive' : undefined;

  return (
    <form action={formAction} className="flex max-w-190 flex-col gap-6">
      {saved && !state.error ? (
        <FormSuccess>Saved — every page and email now uses these values.</FormSuccess>
      ) : null}
      {state.error ? <FormAlert>{state.error}</FormAlert> : null}

      <Section title="bKash — money comes here" tinted>
        <Field
          label="Receiving number"
          htmlFor="bkashReceiveNumber"
          hint="Shown on every payment page and in the payment-instructions email, exactly like this. Blank = “to be announced”."
        >
          <Input
            id="bkashReceiveNumber"
            name="bkashReceiveNumber"
            inputMode="tel"
            placeholder="01712 345678"
            defaultValue={values.bkashReceiveNumber}
            className={cn('font-mono tabular', invalid('bkashReceiveNumber'))}
          />
        </Field>
        <Field
          label="Account name"
          htmlFor="bkashAccountName"
          hint="Buyers see it next to the number so they can check who they are paying."
        >
          <Input
            id="bkashAccountName"
            name="bkashAccountName"
            maxLength={ACCOUNT_NAME_MAX}
            placeholder="Rajibul Karim"
            defaultValue={values.bkashAccountName}
            className={invalid('bkashAccountName')}
          />
        </Field>
        <fieldset className="flex flex-col gap-2">
          <legend className="text-sm font-medium">Account type</legend>
          <div className="flex gap-2" role="radiogroup" aria-label="Account type">
            {(
              [
                ['personal', 'Personal'],
                ['merchant', 'Merchant'],
              ] as const
            ).map(([value, label]) => (
              <label
                key={value}
                className="flex h-11 cursor-pointer items-center gap-2 rounded-lg border border-border-strong bg-card px-4 text-[15px] has-checked:border-foreground has-checked:bg-secondary"
              >
                <input
                  type="radio"
                  name="bkashAccountType"
                  value={value}
                  defaultChecked={values.bkashAccountType === value}
                  className="accent-foreground"
                />
                {label}
              </label>
            ))}
          </div>
          <p className="text-sm leading-snug text-muted-foreground">
            Personal accounts have receiving limits. The wording on the buyer&apos;s payment page
            changes with this setting — &ldquo;Send Money&rdquo; for personal, &ldquo;Payment&rdquo;
            for merchant.
          </p>
        </fieldset>
      </Section>

      <Section title="Support">
        <Field
          label="Support email"
          htmlFor="supportEmail"
          hint="Footer of every page and email, the contact card, and replies to emails go here."
        >
          <Input
            id="supportEmail"
            name="supportEmail"
            type="email"
            placeholder="hello@echoandaura.com"
            defaultValue={values.supportEmail}
            className={invalid('supportEmail')}
          />
        </Field>
        <Field
          label="Support phone"
          htmlFor="supportPhone"
          hint="Contact card, email footers and the check-in sheet — “message Raj on …”."
        >
          <Input
            id="supportPhone"
            name="supportPhone"
            inputMode="tel"
            placeholder="01712 345678"
            defaultValue={values.supportPhone}
            className={cn('tabular', invalid('supportPhone'))}
          />
        </Field>
        <Field
          label="Facebook page"
          htmlFor="facebookPageUrl"
          hint="Header, footer and “Remind me on Facebook”. Leave blank to hide the links."
        >
          <Input
            id="facebookPageUrl"
            name="facebookPageUrl"
            type="url"
            placeholder="https://facebook.com/echoandaura"
            defaultValue={values.facebookPageUrl}
            className={invalid('facebookPageUrl')}
          />
        </Field>
      </Section>

      <Section title="Wording">
        <Field
          label="Verification promise"
          htmlFor="verificationPromise"
          hint={
            <>
              Appears on the payment page, the FAQ and in the instructions email: “A person checks
              your transaction — <em>{values.verificationPromise || 'usually within 4 hours'}</em>.”
              Keep it a promise you can keep at 2am.
            </>
          }
        >
          <Input
            id="verificationPromise"
            name="verificationPromise"
            required
            maxLength={VERIFICATION_PROMISE_MAX}
            placeholder="usually within 4 hours"
            defaultValue={values.verificationPromise}
            className={invalid('verificationPromise')}
          />
        </Field>
        <Field
          label="Organizer name"
          htmlFor="organizerName"
          hint="How you are named in emails, the contact card and the About page."
        >
          <Input
            id="organizerName"
            name="organizerName"
            required
            maxLength={ORGANIZER_NAME_MAX}
            placeholder="Raj"
            defaultValue={values.organizerName}
            className={invalid('organizerName')}
          />
        </Field>
        <Field
          label="Address on tickets & emails"
          htmlFor="organizerAddress"
          hint="Printed in email footers. Optional."
        >
          <Textarea
            id="organizerAddress"
            name="organizerAddress"
            rows={2}
            maxLength={ORGANIZER_ADDRESS_MAX}
            placeholder="House 42, Road 11, Banani, Dhaka 1213"
            defaultValue={values.organizerAddress}
            className={cn('bg-card', invalid('organizerAddress'))}
          />
        </Field>
      </Section>

      <div className="flex flex-wrap items-center gap-4">
        <Button type="submit" disabled={pending}>
          {pending ? 'Saving…' : 'Save settings'}
        </Button>
        <p className="text-sm text-muted-foreground">
          Changing the bKash number does not touch orders already waiting for payment — their pages
          show the new number the next time they load.
        </p>
      </div>
    </form>
  );
}

function Section({
  title,
  tinted,
  children,
}: {
  title: string;
  tinted?: boolean;
  children: ReactNode;
}) {
  return (
    <section
      className={cn(
        'flex flex-col gap-5 rounded-xl border p-5',
        tinted ? 'border-[#c3d6ec] bg-info-tint' : 'border-border bg-card',
      )}
    >
      <h2 className="font-sans text-xs font-medium tracking-widest text-muted-foreground uppercase">
        {title}
      </h2>
      {children}
    </section>
  );
}
