'use client';

import { useActionState } from 'react';
import { ButtonLink } from '@/components/button-link';
import { Field, FormAlert } from '@/components/form-field';
import { Button } from '@/components/button';
import { Card, CardContent, CardFooter } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
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
  /** sold + held — the floor for quantity on an existing type (B6 hint). */
  committed?: number;
  cancelHref: string;
}

// B6 edit form (as a page for now; the design's sheet is a later polish).
export function TicketTypeForm({
  action,
  defaultValues = empty,
  submitLabel,
  committed = 0,
  cancelHref,
}: Props) {
  const [state, formAction, pending] = useActionState(action, {});
  // React resets uncontrolled inputs after an action; re-seed from the last
  // submission so a validation error never wipes the organizer's input.
  const values = state.values ?? defaultValues;

  return (
    <form action={formAction}>
      <Card className="gap-0 py-0">
        <CardContent className="flex flex-col gap-6 px-6 py-6">
          {state.error ? <FormAlert>{state.error}</FormAlert> : null}

          <Field
            label="Name"
            htmlFor="name"
            hint="Shown on the public page and printed on tickets."
          >
            <Input id="name" name="name" defaultValue={values.name} required />
          </Field>

          <div className="grid gap-6 sm:grid-cols-2">
            <Field
              label="Price (৳, e.g. 799.50)"
              htmlFor="priceTaka"
              hint="Changing the price never changes what an existing order owes."
            >
              <div className="relative">
                <span className="pointer-events-none absolute inset-y-0 left-3 flex items-center text-sm text-muted-foreground">
                  ৳
                </span>
                <Input
                  id="priceTaka"
                  name="priceTaka"
                  inputMode="decimal"
                  defaultValue={values.priceTaka}
                  required
                  className="pl-7 tabular"
                />
              </div>
            </Field>
            <Field
              label="Quantity"
              htmlFor="quantityTotal"
              hint={
                committed > 0
                  ? `Cannot go below ${committed} — that is what is already sold plus currently held.`
                  : 'How many tickets of this type exist in total.'
              }
            >
              <Input
                id="quantityTotal"
                name="quantityTotal"
                inputMode="numeric"
                defaultValue={values.quantityTotal}
                required
                className="tabular"
              />
            </Field>
          </div>

          <fieldset className="flex flex-col gap-4 rounded-lg border border-border p-4">
            <legend className="px-1 text-sm font-medium">
              Sales window <span className="font-normal text-muted-foreground">· optional</span>
            </legend>
            <div className="grid gap-6 sm:grid-cols-2">
              <Field label="Sales start (optional — Early Bird window)" htmlFor="salesStartsAt">
                <Input
                  id="salesStartsAt"
                  name="salesStartsAt"
                  type="datetime-local"
                  defaultValue={values.salesStartsAt}
                />
              </Field>
              <Field label="Sales end (optional)" htmlFor="salesEndsAt">
                <Input
                  id="salesEndsAt"
                  name="salesEndsAt"
                  type="datetime-local"
                  defaultValue={values.salesEndsAt}
                />
              </Field>
            </div>
            <p className="text-sm text-muted-foreground">
              Leave both empty for a type that sells the whole time. Set an end date to make an
              Early Bird.
            </p>
          </fieldset>
        </CardContent>
        <CardFooter className="justify-between border-t border-border px-6 py-4">
          <ButtonLink variant="ghost" href={cancelHref}>
            Cancel
          </ButtonLink>
          <Button type="submit" disabled={pending}>
            {pending ? 'Saving…' : submitLabel}
          </Button>
        </CardFooter>
      </Card>
    </form>
  );
}
