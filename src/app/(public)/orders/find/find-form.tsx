'use client';

import { useActionState } from 'react';
import { Button } from '@/components/button';
import { FieldHint } from '@/components/form-field';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { BD_MOBILE_PREFIX } from '@/lib/validation/orders';
import type { FindOrderState } from './actions';

export function FindOrderForm({
  action,
}: {
  action: (prev: FindOrderState, formData: FormData) => Promise<FindOrderState>;
}) {
  const [state, formAction, pending] = useActionState(action, {});
  return (
    <form action={formAction} className="flex flex-col gap-5" noValidate>
      {state.error ? (
        <p
          role="alert"
          className="rounded-xl border border-l-4 border-destructive/30 border-l-destructive bg-destructive-tint px-4 py-3 text-sm leading-relaxed"
        >
          {state.error}
        </p>
      ) : null}
      <div className="flex flex-col gap-2">
        <Label htmlFor="reference">Order reference</Label>
        <Input
          id="reference"
          name="reference"
          placeholder="EA-7K3M9Q"
          autoCapitalize="characters"
          spellCheck={false}
          defaultValue={state.values?.reference ?? ''}
          className="h-11 bg-card font-mono text-[17px] tracking-wide tabular"
        />
        <FieldHint>
          Starts with EA- — it is in the bKash reference field and in your emails.
        </FieldHint>
      </div>
      <div className="flex flex-col gap-2">
        <Label htmlFor="phone">Mobile number you registered with</Label>
        <div className="flex items-stretch">
          <span className="flex items-center rounded-l-md border border-r-0 border-input bg-secondary px-3 text-[15px] text-muted-foreground tabular">
            {BD_MOBILE_PREFIX}
          </span>
          <Input
            id="phone"
            name="phone"
            type="tel"
            inputMode="numeric"
            placeholder="1712345678"
            defaultValue={state.values?.phone ?? ''}
            className="h-11 rounded-l-none bg-card tabular"
          />
        </div>
      </div>
      <Button type="submit" variant="cta" size="lg" className="w-full" disabled={pending}>
        {pending ? 'Looking…' : 'Find my order'}
      </Button>
    </form>
  );
}
