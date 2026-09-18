'use client';

import { useActionState } from 'react';
import type { EventFormState } from './actions';

export interface EventFormValues {
  title: string;
  slug: string;
  description: string;
  venue: string;
  startsAt: string;
  endsAt: string;
  registrationOpensAt: string;
  registrationClosesAt: string;
}

const empty: EventFormValues = {
  title: '',
  slug: '',
  description: '',
  venue: '',
  startsAt: '',
  endsAt: '',
  registrationOpensAt: '',
  registrationClosesAt: '',
};

interface Props {
  action: (prev: EventFormState, formData: FormData) => Promise<EventFormState>;
  defaultValues?: EventFormValues;
  submitLabel: string;
  saved?: boolean;
}

// TEMPORARY DEMO MARKUP — the real UI is designed separately (Claude Design).
// Presentation only; all logic lives in ./actions.ts and the service layer.
export function EventForm({ action, defaultValues = empty, submitLabel, saved }: Props) {
  const [state, formAction, pending] = useActionState(action, {});
  // After an action React resets uncontrolled inputs to their defaultValue;
  // seeding from the last submission keeps the organizer's input on error.
  const values = state.values ?? defaultValues;

  return (
    <form action={formAction} className="flex max-w-xl flex-col gap-3">
      <Field label="Title" name="title" defaultValue={values.title} required />
      <Field
        label="URL slug (optional — derived from the title when blank)"
        name="slug"
        defaultValue={values.slug}
      />
      <label className="flex flex-col gap-1 text-sm">
        Description
        <textarea
          name="description"
          rows={4}
          defaultValue={values.description}
          className="rounded border px-3 py-2"
        />
      </label>
      <Field label="Venue" name="venue" defaultValue={values.venue} />
      <Field
        label="Starts at (Dhaka time)"
        name="startsAt"
        type="datetime-local"
        defaultValue={values.startsAt}
        required
      />
      <Field
        label="Ends at (optional)"
        name="endsAt"
        type="datetime-local"
        defaultValue={values.endsAt}
      />
      <Field
        label="Registration opens (optional — default 20 days before)"
        name="registrationOpensAt"
        type="datetime-local"
        defaultValue={values.registrationOpensAt}
      />
      <Field
        label="Registration closes (optional — default 5 days before)"
        name="registrationClosesAt"
        type="datetime-local"
        defaultValue={values.registrationClosesAt}
      />

      {state.error ? (
        <p role="alert" className="text-sm text-red-600">
          {state.error}
        </p>
      ) : null}
      {saved && !state.error ? (
        <p role="status" className="text-sm text-green-700">
          Event saved
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
  defaultValue,
  required,
}: {
  label: string;
  name: keyof EventFormValues;
  type?: 'text' | 'datetime-local';
  defaultValue: string;
  required?: boolean;
}) {
  return (
    <label className="flex flex-col gap-1 text-sm">
      {label}
      <input
        name={name}
        type={type}
        defaultValue={defaultValue}
        required={required}
        className="rounded border px-3 py-2"
      />
    </label>
  );
}
