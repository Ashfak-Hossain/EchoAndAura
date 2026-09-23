'use client';

import { Minus, Plus } from 'lucide-react';
import { useActionState, useState } from 'react';
import { formatBDT } from '@/server/lib/money';
import { MAX_TICKETS_PER_ORDER } from '@/server/lib/order-rules';
import { Button } from '@/components/button';
import { Field, FieldHint, FormAlert } from '@/components/form-field';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { COMP_REASON_MAX, type ComplimentaryField } from '@/lib/validation/complimentary-tickets';
import type { CompFormState } from './comp-actions';

export interface CompTicketTypeOption {
  id: string;
  name: string;
  pricePaisa: number;
  available: number;
}

interface Props {
  action: (prev: CompFormState, formData: FormData) => Promise<CompFormState>;
  ticketTypes: CompTicketTypeOption[];
  /** The row the organizer clicked "Issue comps" on, when there was one. */
  initialTicketTypeId: string | null;
  onDone: () => void;
}

/**
 * B13 sheet body. The select and the stepper are controlled (the stepper
 * caps at what is left, and the button names the count and type); the rest
 * is uncontrolled. The server re-checks stock with the atomic hold — the
 * cap here is a courtesy, not the rule.
 */
export function CompTicketsForm({ action, ...rest }: Props) {
  const [state, formAction, pending] = useActionState(action, {});
  return (
    <form action={formAction} className="flex min-h-0 flex-1 flex-col" noValidate>
      {/* React 19 resets the form's DOM after an action; remount per result. */}
      <CompFields key={state.nonce ?? 'initial'} state={state} pending={pending} {...rest} />
    </form>
  );
}

function CompFields({
  state,
  pending,
  ticketTypes,
  initialTicketTypeId,
  onDone,
}: Omit<Props, 'action'> & { state: CompFormState; pending: boolean }) {
  const seed = state.values;
  const firstOpen = ticketTypes.find((t) => t.available > 0)?.id ?? '';
  const [typeId, setTypeId] = useState(seed?.ticketTypeId || initialTicketTypeId || firstOpen);
  const [quantity, setQuantity] = useState(() => {
    const n = Number.parseInt(seed?.quantity ?? '', 10);
    return Number.isInteger(n) && n >= 1 ? n : 1;
  });
  const selected = ticketTypes.find((t) => t.id === typeId) ?? null;
  const maxQty = Math.max(1, Math.min(MAX_TICKETS_PER_ORDER, selected?.available ?? 1));
  const shown = Math.min(quantity, maxQty);

  const err = (f: ComplimentaryField) => (state.field === f ? state.error : null);
  const bannerError = state.error && !state.field ? state.error : null;

  return (
    <>
      <div className="flex flex-1 flex-col gap-6 overflow-y-auto px-6 pb-6">
        <div className="flex gap-3 rounded-[10px] border border-[#f0d9ac] bg-accent p-3.5">
          <div
            aria-hidden="true"
            className="w-[5px] shrink-0 self-stretch rounded-sm bg-marigold"
          />
          <p className="text-sm leading-normal text-[#5c4514]">
            Comps take real stock and show as {formatBDT(0)} in reports. They cannot be undone —
            only cancelled ticket by ticket.
          </p>
        </div>

        {bannerError ? <FormAlert>{bannerError}</FormAlert> : null}

        <Field label="Ticket type" htmlFor="comp-type">
          <select
            id="comp-type"
            name="ticketTypeId"
            value={typeId}
            onChange={(e) => setTypeId(e.target.value)}
            aria-invalid={Boolean(err('ticketTypeId'))}
            className="h-12 w-full rounded-md border border-input bg-card px-3 text-base outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
          >
            {typeId === '' ? <option value="">Choose a ticket type</option> : null}
            {ticketTypes.map((t) => (
              <option key={t.id} value={t.id} disabled={t.available <= 0}>
                {t.name} — {t.available > 0 ? `${t.available} available` : 'none left'}
              </option>
            ))}
          </select>
          {err('ticketTypeId') ? <InlineError>{err('ticketTypeId')}</InlineError> : null}
        </Field>

        <div className="flex flex-col gap-2">
          <Label htmlFor="comp-quantity">How many</Label>
          <div className="flex items-center gap-3">
            <StepButton
              label="Fewer tickets"
              disabled={shown <= 1}
              onClick={() => setQuantity(Math.max(1, shown - 1))}
            >
              <Minus />
            </StepButton>
            <input
              id="comp-quantity"
              name="quantity"
              type="number"
              inputMode="numeric"
              min={1}
              max={maxQty}
              value={shown}
              onChange={(e) => {
                const n = Number.parseInt(e.target.value, 10);
                if (Number.isInteger(n)) setQuantity(Math.max(1, Math.min(maxQty, n)));
              }}
              aria-invalid={Boolean(err('quantity'))}
              className="h-11 w-16 rounded-md border border-input bg-card text-center text-lg font-semibold tabular outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
            />
            <StepButton
              label="More tickets"
              disabled={shown >= maxQty}
              onClick={() => setQuantity(Math.min(maxQty, shown + 1))}
            >
              <Plus />
            </StepButton>
          </div>
          {err('quantity') ? (
            <InlineError>{err('quantity')}</InlineError>
          ) : (
            <FieldHint>Up to {MAX_TICKETS_PER_ORDER} at a time.</FieldHint>
          )}
        </div>

        <Field
          label="Name on the tickets"
          htmlFor="comp-name"
          hint={
            err('guestName')
              ? undefined
              : `${shown === 1 ? 'The ticket gets' : shown === 2 ? 'Both tickets get' : `All ${shown} tickets get`} this name; edit them individually afterwards.`
          }
        >
          <Input
            id="comp-name"
            name="guestName"
            defaultValue={seed?.guestName ?? ''}
            autoComplete="off"
            aria-invalid={Boolean(err('guestName'))}
            className="h-12"
          />
          {err('guestName') ? <InlineError>{err('guestName')}</InlineError> : null}
        </Field>

        <Field
          label="Email"
          htmlFor="comp-email"
          hint={err('guestEmail') ? undefined : 'The tickets email goes here.'}
        >
          <Input
            id="comp-email"
            name="guestEmail"
            type="email"
            defaultValue={seed?.guestEmail ?? ''}
            autoComplete="off"
            aria-invalid={Boolean(err('guestEmail'))}
            className="h-12"
          />
          {err('guestEmail') ? <InlineError>{err('guestEmail')}</InlineError> : null}
        </Field>

        <Field
          label={
            <>
              Reason <span className="text-destructive">· required</span>
            </>
          }
          htmlFor="comp-reason"
          hint={err('reason') ? undefined : 'Kept in the audit trail, never shown to the guest.'}
        >
          <Textarea
            id="comp-reason"
            name="reason"
            rows={3}
            maxLength={COMP_REASON_MAX}
            defaultValue={seed?.reason ?? ''}
            placeholder="e.g. Press — Dhaka Press review, agreed with Raj on 14 Sep."
            aria-invalid={Boolean(err('reason'))}
          />
          {err('reason') ? <InlineError>{err('reason')}</InlineError> : null}
        </Field>
      </div>

      <div className="flex justify-end gap-2 border-t border-border bg-card px-6 py-4">
        <Button type="button" variant="secondary" onClick={onDone}>
          Cancel
        </Button>
        <Button type="submit" disabled={pending || !selected || selected.available <= 0}>
          {pending
            ? 'Issuing…'
            : selected
              ? `Issue ${shown} ${selected.name} ${shown === 1 ? 'ticket' : 'tickets'}`
              : 'Issue tickets'}
        </Button>
      </div>
    </>
  );
}

function StepButton({
  label,
  disabled,
  onClick,
  children,
}: {
  label: string;
  disabled: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      disabled={disabled}
      onClick={onClick}
      className="inline-flex size-11 items-center justify-center rounded-md border border-border-strong bg-card text-foreground transition-colors outline-none hover:bg-secondary focus-visible:ring-2 focus-visible:ring-foreground disabled:cursor-not-allowed disabled:border-border disabled:text-[#a8a29a] [&_svg]:size-4"
    >
      {children}
    </button>
  );
}

function InlineError({ children }: { children: React.ReactNode }) {
  return (
    <p className="text-sm leading-snug font-medium text-destructive" role="alert">
      {children}
    </p>
  );
}
