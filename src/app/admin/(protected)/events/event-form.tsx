'use client';

import { useActionState } from 'react';
import { Field, FormAlert, FormSuccess } from '@/components/form-field';
import { Button } from '@/components/button';
import { Card, CardContent, CardFooter } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
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
  /** Shown under the slug field once the event exists. */
  publicUrl?: string;
}

// B5 Details tab. Presentation only; all logic lives in ./actions.ts.
export function EventForm({ action, defaultValues = empty, submitLabel, saved, publicUrl }: Props) {
  const [state, formAction, pending] = useActionState(action, {});
  // After an action React resets uncontrolled inputs to their defaultValue;
  // seeding from the last submission keeps the organizer's input on error.
  const values = state.values ?? defaultValues;

  return (
    <form action={formAction}>
      <Card className="gap-0 py-0">
        <CardContent className="flex flex-col gap-6 px-6 py-6">
          {state.error ? <FormAlert>{state.error}</FormAlert> : null}
          {saved && !state.error ? <FormSuccess>Event saved</FormSuccess> : null}

          <Field label="Title" htmlFor="title">
            <Input id="title" name="title" defaultValue={values.title} required />
          </Field>

          <Field
            label="URL slug (optional — derived from the title when blank)"
            htmlFor="slug"
            hint={
              publicUrl ? (
                <>
                  Public page: <span className="font-mono text-foreground">{publicUrl}</span> —
                  changing it breaks links already shared on Facebook.
                </>
              ) : (
                'Lowercase letters, numbers and dashes. Leave blank to derive it from the title.'
              )
            }
          >
            <Input id="slug" name="slug" defaultValue={values.slug} className="font-mono" />
          </Field>

          <Field label="Description" htmlFor="description">
            <Textarea
              id="description"
              name="description"
              rows={5}
              defaultValue={values.description}
            />
          </Field>

          <Field label="Venue" htmlFor="venue">
            <Input id="venue" name="venue" defaultValue={values.venue} />
          </Field>

          <div className="grid gap-6 sm:grid-cols-2">
            <Field label="Starts at (Dhaka time)" htmlFor="startsAt">
              <Input
                id="startsAt"
                name="startsAt"
                type="datetime-local"
                defaultValue={values.startsAt}
                required
              />
            </Field>
            <Field label="Ends at (optional)" htmlFor="endsAt">
              <Input id="endsAt" name="endsAt" type="datetime-local" defaultValue={values.endsAt} />
            </Field>
          </div>

          <div className="grid gap-6 sm:grid-cols-2">
            <Field
              label="Registration opens (optional — default 20 days before)"
              htmlFor="registrationOpensAt"
              hint="Default: 20 days before the event."
            >
              <Input
                id="registrationOpensAt"
                name="registrationOpensAt"
                type="datetime-local"
                defaultValue={values.registrationOpensAt}
              />
            </Field>
            <Field
              label="Registration closes (optional — default 5 days before)"
              htmlFor="registrationClosesAt"
              hint="Must close before the event starts. Default: 5 days before."
            >
              <Input
                id="registrationClosesAt"
                name="registrationClosesAt"
                type="datetime-local"
                defaultValue={values.registrationClosesAt}
              />
            </Field>
          </div>

          <p className="text-xs text-muted-foreground">
            All times Dhaka · stored in UTC, rendered Asia/Dhaka.
          </p>
        </CardContent>
        <CardFooter className="border-t border-border px-6 py-4">
          <Button type="submit" disabled={pending}>
            {pending ? 'Saving…' : submitLabel}
          </Button>
        </CardFooter>
      </Card>
    </form>
  );
}
