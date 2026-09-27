'use client';

import { useActionState } from 'react';
import { Field, FormAlert, FormSuccess } from '@/components/form-field';
import { Button } from '@/components/button';
import { Card, CardContent, CardFooter } from '@/components/ui/card';
import { RichTextEditor } from '@/components/rich-text-editor';
import { Input } from '@/components/ui/input';
import type { EventFormState } from './actions';

export interface EventFormValues {
  title: string;
  slug: string;
  description: string;
  venue: string;
  venueHidden: boolean;
  venueArea: string;
  startsAt: string;
  endsAt: string;
  registrationOpensAt: string;
  registrationClosesAt: string;
  /** '' is "None". */
  presentingSponsorId: string;
}

/** A sponsor the "Presenting sponsor" select offers — hidden ones included, marked. */
export interface PresentingSponsorOption {
  id: string;
  name: string;
  active: boolean;
}

const empty: EventFormValues = {
  title: '',
  slug: '',
  description: '',
  venue: '',
  venueHidden: false,
  venueArea: '',
  startsAt: '',
  endsAt: '',
  registrationOpensAt: '',
  registrationClosesAt: '',
  presentingSponsorId: '',
};

interface Props {
  action: (prev: EventFormState, formData: FormData) => Promise<EventFormState>;
  defaultValues?: EventFormValues;
  /** Every sponsor, in the B15 list's order. */
  sponsors: PresentingSponsorOption[];
  submitLabel: string;
  saved?: boolean;
  /** Shown under the slug field once the event exists. */
  publicUrl?: string;
}

// B5 Details tab. Presentation only; all logic lives in ./actions.ts.
export function EventForm({
  action,
  defaultValues = empty,
  sponsors,
  submitLabel,
  saved,
  publicUrl,
}: Props) {
  const [state, formAction, pending] = useActionState(action, {});
  // After an action React resets uncontrolled inputs to their defaultValue;
  // seeding from the last submission keeps the organizer's input on error.
  const values = state.values ?? defaultValues;
  const sponsorError = state.field === 'presentingSponsorId' ? state.error : null;
  const bannerError = state.error && !state.field ? state.error : null;

  return (
    <form action={formAction}>
      <Card className="gap-0 py-0">
        <CardContent className="flex flex-col gap-6 px-6 py-6">
          {bannerError ? <FormAlert>{bannerError}</FormAlert> : null}
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

          <Field
            label={<span id="description-label">Description</span>}
            htmlFor="description"
            hint="Shown on the public event page. Headings, lists and links are kept; anything else is stripped."
          >
            <RichTextEditor
              id="description"
              name="description"
              labelledBy="description-label"
              defaultValue={values.description}
            />
          </Field>

          {/* The area field shows only while "private" is ticked — pure CSS, so
              the checkbox stays uncontrolled and survives React's form reset. */}
          <div className="group flex flex-col gap-3">
            <Field label="Venue" htmlFor="venue">
              <Input id="venue" name="venue" defaultValue={values.venue} />
            </Field>
            <label className="flex items-start gap-2.5 text-[15px]">
              <input
                type="checkbox"
                id="venueHidden"
                name="venueHidden"
                defaultChecked={values.venueHidden}
                className="mt-1 size-4 shrink-0 accent-foreground"
              />
              <span>
                Keep the venue private — only ticket holders get it (tickets email, ticket page,
                PDF).
              </span>
            </label>
            <div className="hidden pl-6.5 group-has-[#venueHidden:checked]:block">
              <Field
                label="Public area (optional)"
                htmlFor="venueArea"
                hint="Shown instead of the venue, with “Exact venue is sent with your tickets”. e.g. Tejgaon, Dhaka"
              >
                <Input id="venueArea" name="venueArea" defaultValue={values.venueArea} />
              </Field>
            </div>
          </div>

          <Field
            label="Presenting sponsor"
            htmlFor="presentingSponsorId"
            hint="Shown on the event page as “Presented by”. Hidden sponsors are not shown."
          >
            <select
              id="presentingSponsorId"
              name="presentingSponsorId"
              defaultValue={values.presentingSponsorId}
              aria-invalid={sponsorError ? true : undefined}
              aria-describedby={sponsorError ? 'presentingSponsorId-error' : undefined}
              className="h-9 w-full rounded-md border border-input bg-card px-2.5 text-base shadow-xs outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 aria-invalid:border-destructive aria-invalid:ring-3 aria-invalid:ring-destructive/20 md:text-sm"
            >
              <option value="">None</option>
              {sponsors.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.active ? s.name : `${s.name} (hidden)`}
                </option>
              ))}
            </select>
            {sponsorError ? (
              <p
                id="presentingSponsorId-error"
                role="alert"
                className="text-sm leading-snug font-medium text-destructive"
              >
                {sponsorError}
              </p>
            ) : null}
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
