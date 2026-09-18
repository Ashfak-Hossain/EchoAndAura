'use client';

import { useActionState } from 'react';
import type { TicketTypeFormState } from './actions';

export interface TicketTypeFormValues {
  name: string;
  priceTaka: string;
  quantityTotal: string;
  salesStartsAt: string;
  salesEndsAt: string;
}

const empty: TicketTypeFormValues = {
  name: '',
  priceTaka: '',
  quantityTotal: '',
  salesStartsAt: '',
  salesEndsAt: '',
};

interface Props {
  action: (prev: TicketTypeFormState, formData: FormData) => Promise<TicketTypeFormState>;
  defaultValues?: TicketTypeFormValues;
  submitLabel: string;
}

// TEMPORARY DEMO MARKUP — the real UI is designed separately (Claude Design).
// Presentation only; all logic lives in ./actions.ts and the service layer.
export function TicketTypeForm({ action, defaultValues = empty, submitLabel }: Props) {
  const [state, formAction, pending] = useActionState(action, {});
  // After an action React resets uncontrolled inputs to their defaultValue;
  // seeding from the last submission keeps the organizer's input on error.
  const values = state.values ?? defaultValues;

  return (
    <form action={formAction} className="flex max-w-xl flex-col gap-3">
      <Field label="Name" name="name" defaultValue={values.name} required />
      <Field
        label="Price (৳, e.g. 799.50)"
        name="priceTaka"
        inputMode="decimal"
        defaultValue={values.priceTaka}
        required
      />
      <Field
        label="Quantity"
        name="quantityTotal"
        inputMode="numeric"
        defaultValue={values.quantityTotal}
        required
      />
      <Field
        label="Sales start (optional — Early Bird window)"
        name="salesStartsAt"
        type="datetime-local"
        defaultValue={values.salesStartsAt}
      />
      <Field
        label="Sales end (optional)"
        name="salesEndsAt"
        type="datetime-local"
        defaultValue={values.salesEndsAt}
      />

      {state.error ? (
        <p role="alert" className="text-sm text-red-600">
          {state.error}
        </p>
      ) : null}

      <button
        type="submit"
        disabled={pending}
        className="self-start rounded bg-black px-3 py-2 text-white disabled:opacity-50"
      >
        {pending ? 'Saving…' : submitLabel}
      </button>
    </form>
  );
}

function Field({
  label,
  name,
  type = 'text',
  inputMode,
  defaultValue,
  required,
}: {
  label: string;
  name: keyof TicketTypeFormValues;
  type?: 'text' | 'datetime-local';
  inputMode?: 'decimal' | 'numeric';
  defaultValue: string;
  required?: boolean;
}) {
  return (
    <label className="flex flex-col gap-1 text-sm">
      {label}
      <input
        name={name}
        type={type}
        inputMode={inputMode}
        defaultValue={defaultValue}
        required={required}
        className="rounded border px-3 py-2"
      />
    </label>
  );
}
