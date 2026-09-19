'use client';

import { Minus, Plus } from 'lucide-react';
import { useActionState, useEffect, useMemo, useRef, useState } from 'react';
import { MAX_TICKETS_PER_ORDER } from '@/server/lib/order-rules';
import { Button } from '@/components/button';
import { FieldHint } from '@/components/form-field';
import { Money } from '@/components/money';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { BD_MOBILE_PREFIX } from '@/lib/validation/orders';
import { cn } from '@/lib/utils';
import type { RegistrationFormState } from './actions';

export interface TicketOption {
  id: string;
  name: string;
  pricePaisa: number;
  /** Tickets left right now (0 when not purchasable). */
  available: number;
  /** min(10, available) — 0 disables the row. */
  maxPerOrder: number;
  /** Why the row is disabled, or null when it can be chosen. */
  reason: string | null;
}

interface Props {
  action: (prev: RegistrationFormState, formData: FormData) => Promise<RegistrationFormState>;
  options: TicketOption[];
  registrationClosesAt: string | null;
}

const str = (v: unknown) => (typeof v === 'string' ? v : '');

/**
 * A3 registration form: ticket radio group, quantity stepper, buyer details,
 * one attendee name per ticket, order summary, terms. The summary maths is
 * display only — the server recomputes every number from the ticket_types
 * row (Invariant 5) and re-checks stock atomically on submit.
 */
export function RegistrationForm({ action, options, registrationClosesAt }: Props) {
  const [state, formAction, pending] = useActionState(action, {});
  // After an action React resets uncontrolled inputs; seeding from the last
  // submission keeps the buyer's input on error (nothing is ever cleared).
  const values = state.values ?? {};
  const errors = state.fieldErrors ?? {};
  const errorCount = Object.keys(errors).length;

  // A type that sold out on submit is disabled below and cannot stay selected,
  // otherwise the summary and the button would still act on it.
  const soldOutId = state.banner?.soldOutTicketTypeId;
  const firstChoosable = options.find((o) => o.maxPerOrder > 0 && o.id !== soldOutId);
  const [ticketTypeId, setTicketTypeId] = useState<string>(
    str(values.ticketTypeId) || firstChoosable?.id || '',
  );
  const selected =
    options.find((o) => o.id === ticketTypeId && o.id !== soldOutId && o.maxPerOrder > 0) ?? null;

  const [quantity, setQuantity] = useState<number>(() => {
    const n = Number.parseInt(str(values.quantity), 10);
    return Number.isInteger(n) && n >= 1 ? n : 1;
  });
  const maxQty = selected?.maxPerOrder ?? 0;
  const overStock = selected !== null && quantity > selected.available;

  const [buyerName, setBuyerName] = useState(str(values.buyerName));
  const submittedNames = Array.isArray(values.attendeeNames)
    ? values.attendeeNames.map(str)
    : [];
  const [typedNames, setTypedNames] = useState<string[]>(submittedNames);
  const [firstIsMe, setFirstIsMe] = useState(false);
  // Exactly one name per ticket, derived: the quantity decides how many
  // fields exist and "Ticket 1 is for me" mirrors the buyer's name live.
  const names = Array.from({ length: quantity }, (_, i) =>
    i === 0 && firstIsMe ? buyerName : (typedNames[i] ?? ''),
  );

  // Failed submit: focus moves to the summary (design A3 · validation errors).
  const summaryRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (errorCount > 0 || state.banner) summaryRef.current?.focus();
  }, [errorCount, state.banner]);

  const subtotal = useMemo(
    () => (selected ? selected.pricePaisa * quantity : 0),
    [selected, quantity],
  );

  return (
    <form action={formAction} className="flex flex-col gap-8 pb-24 lg:pb-0" noValidate>
      {state.banner || errorCount > 0 ? (
        <div
          ref={summaryRef}
          tabIndex={-1}
          role="alert"
          className="flex flex-col gap-1 rounded-xl border border-destructive/30 border-l-4 border-l-destructive bg-destructive-tint px-4 py-3.5 outline-none"
        >
          <p className="text-[15px] font-semibold">
            {state.banner
              ? state.banner.title
              : `${errorCount} ${errorCount === 1 ? 'thing needs' : 'things need'} fixing`}
          </p>
          <p className="text-sm leading-relaxed">
            {state.banner ? state.banner.body : Object.values(errors).join(' ')}
          </p>
        </div>
      ) : null}

      {/* Ticket type */}
      <fieldset className="flex flex-col gap-3">
        <legend className="mb-1 text-[15px] font-semibold">Ticket type</legend>
        <p className="-mt-1 text-sm text-muted-foreground">
          One ticket type per order, up to {MAX_TICKETS_PER_ORDER} tickets.
        </p>
        {options.map((o) => {
          const disabled = o.maxPerOrder === 0 || o.id === soldOutId;
          const checked = ticketTypeId === o.id && !disabled;
          return (
            <label
              key={o.id}
              className={cn(
                'flex cursor-pointer items-start gap-3 rounded-xl border p-3.5 transition-colors',
                disabled
                  ? 'cursor-not-allowed border-border bg-secondary text-muted-foreground'
                  : checked
                    ? 'border-foreground bg-card ring-1 ring-foreground'
                    : 'border-border-strong bg-card hover:bg-secondary',
              )}
            >
              <input
                type="radio"
                name="ticketTypeId"
                value={o.id}
                checked={checked}
                disabled={disabled}
                onChange={() => {
                  setTicketTypeId(o.id);
                  setQuantity((q) => Math.min(q, o.maxPerOrder));
                }}
                className="mt-1 size-4 accent-foreground"
              />
              <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                <span className="flex items-baseline justify-between gap-3">
                  <span className="font-semibold">{o.name}</span>
                  <Money paisa={o.pricePaisa} className="font-semibold" />
                </span>
                <span className={cn('text-[13px]', !disabled && o.available <= 10 && 'font-medium text-[#7a4600]')}>
                  {o.id === soldOutId
                    ? 'Sold out'
                    : (o.reason ??
                      (o.available <= 10 ? `Only ${o.available} left` : `${o.available} left`))}
                </span>
              </span>
            </label>
          );
        })}
        {errors.ticketTypeId ? <FieldError>{errors.ticketTypeId}</FieldError> : null}
      </fieldset>

      {/* Quantity */}
      <div className="flex flex-col gap-2">
        <Label htmlFor="quantity">Number of tickets</Label>
        <div className="flex items-center gap-3">
          <StepButton
            label="Fewer tickets"
            disabled={quantity <= 1}
            onClick={() => setQuantity((q) => Math.max(1, q - 1))}
          >
            <Minus />
          </StepButton>
          <input
            id="quantity"
            name="quantity"
            type="number"
            inputMode="numeric"
            min={1}
            max={Math.max(1, maxQty)}
            value={quantity}
            onChange={(e) => {
              const n = Number.parseInt(e.target.value, 10);
              if (Number.isInteger(n)) setQuantity(Math.max(1, Math.min(MAX_TICKETS_PER_ORDER, n)));
            }}
            className="tabular h-11 w-16 rounded-md border border-input bg-card text-center text-lg font-semibold outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
          />
          <StepButton
            label="More tickets"
            disabled={quantity >= maxQty}
            onClick={() => setQuantity((q) => Math.min(maxQty, q + 1))}
          >
            <Plus />
          </StepButton>
        </div>
        <FieldHint>
          Max {MAX_TICKETS_PER_ORDER} per order.
          {selected ? ` ${selected.available} left at this price.` : ''}
        </FieldHint>
        {overStock && selected ? (
          <FieldError>
            Only {selected.available} {selected.name} tickets are left. Lower the quantity to{' '}
            {selected.available} or fewer to continue.
          </FieldError>
        ) : null}
        {errors.quantity ? <FieldError>{errors.quantity}</FieldError> : null}
      </div>

      {/* Your details */}
      <fieldset className="flex flex-col gap-5">
        <legend className="mb-1 text-[15px] font-semibold">Your details</legend>
        <p className="-mt-1 text-sm text-muted-foreground">
          Tickets are emailed to this address once your payment is checked.
        </p>
        <div className="flex flex-col gap-2">
          <Label htmlFor="buyerName">Full name</Label>
          <Input
            id="buyerName"
            name="buyerName"
            autoComplete="name"
            value={buyerName}
            onChange={(e) => setBuyerName(e.target.value)}
            aria-invalid={Boolean(errors.buyerName)}
            className="h-11 bg-card"
          />
          {errors.buyerName ? <FieldError>{errors.buyerName}</FieldError> : null}
        </div>
        <div className="flex flex-col gap-2">
          <Label htmlFor="buyerEmail">Email address</Label>
          <Input
            id="buyerEmail"
            name="buyerEmail"
            type="email"
            autoComplete="email"
            inputMode="email"
            defaultValue={str(values.buyerEmail)}
            aria-invalid={Boolean(errors.buyerEmail)}
            className="h-11 bg-card"
          />
          {errors.buyerEmail ? (
            <FieldError>{errors.buyerEmail}</FieldError>
          ) : (
            <FieldHint>Check it carefully — this is where the tickets go.</FieldHint>
          )}
        </div>
        <div className="flex flex-col gap-2">
          <Label htmlFor="buyerPhone">Mobile number</Label>
          <div className="flex items-stretch">
            <span className="tabular flex items-center rounded-l-md border border-r-0 border-input bg-secondary px-3 text-[15px] text-muted-foreground">
              {BD_MOBILE_PREFIX}
            </span>
            <Input
              id="buyerPhone"
              name="buyerPhone"
              type="tel"
              inputMode="numeric"
              autoComplete="tel-national"
              placeholder="1712345678"
              defaultValue={str(values.buyerPhone)}
              aria-invalid={Boolean(errors.buyerPhone)}
              className="tabular h-11 rounded-l-none bg-card"
            />
          </div>
          {errors.buyerPhone ? (
            <FieldError>{errors.buyerPhone}</FieldError>
          ) : (
            <FieldHint>The number you will send the bKash payment from.</FieldHint>
          )}
        </div>
      </fieldset>

      {/* Who is coming */}
      <fieldset className="flex flex-col gap-4">
        <legend className="mb-1 text-[15px] font-semibold">Who is coming?</legend>
        <p className="-mt-1 text-sm text-muted-foreground">
          One name per ticket.
          {registrationClosesAt
            ? ` You can change these until registration closes on ${registrationClosesAt}.`
            : ''}
        </p>
        <label className="flex items-center gap-2.5 text-[15px]">
          <input
            type="checkbox"
            checked={firstIsMe}
            onChange={(e) => setFirstIsMe(e.target.checked)}
            className="size-4 accent-foreground"
          />
          Ticket 1 is for me
        </label>
        {names.map((name, i) => {
          const key = `attendeeNames.${i}`;
          return (
            <div key={i} className="flex flex-col gap-2">
              <Label htmlFor={key}>Ticket {i + 1} — attendee name</Label>
              <Input
                id={key}
                name="attendeeNames"
                autoComplete="off"
                value={name}
                onChange={(e) => {
                  const next = [...names];
                  next[i] = e.target.value;
                  setTypedNames(next);
                  if (i === 0 && firstIsMe) setFirstIsMe(false);
                }}
                readOnly={i === 0 && firstIsMe}
                aria-invalid={Boolean(errors[key])}
                className="h-11 bg-card"
              />
              {errors[key] ? <FieldError>{errors[key]}</FieldError> : null}
            </div>
          );
        })}
        {errors.attendeeNames ? <FieldError>{errors.attendeeNames}</FieldError> : null}
      </fieldset>

      {/* Summary */}
      <section aria-labelledby="summary-heading" className="flex flex-col gap-2.5 rounded-xl border border-border bg-card p-4">
        <h2 id="summary-heading" className="font-sans text-xs font-medium tracking-widest text-muted-foreground uppercase">
          Order summary
        </h2>
        <dl className="flex flex-col gap-1.5 text-[15px]">
          <div className="flex justify-between gap-4">
            <dt>
              {selected ? `${selected.name} × ${quantity}` : 'No ticket chosen'}
            </dt>
            <dd>
              <Money paisa={subtotal} />
            </dd>
          </div>
          <div className="flex justify-between gap-4 border-t border-border pt-2 text-lg font-semibold">
            <dt>Total</dt>
            <dd data-testid="summary-total">
              <Money paisa={subtotal} />
            </dd>
          </div>
        </dl>
        <p className="text-[13px] leading-snug text-muted-foreground">
          The final price is confirmed by our server when you submit, so what you pay always
          matches what you see here.
        </p>
      </section>

      {/* Terms */}
      <div className="flex flex-col gap-2">
        <label className="flex items-start gap-2.5 text-[15px] leading-snug">
          <input
            type="checkbox"
            name="terms"
            defaultChecked={str(values.terms) === 'on'}
            aria-invalid={Boolean(errors.terms)}
            className="mt-1 size-4 shrink-0 accent-foreground"
          />
          I agree to the terms and understand that payments are checked by hand and there are no
          refunds in the app.
        </label>
        {errors.terms ? <FieldError>{errors.terms}</FieldError> : null}
      </div>

      {/* Sticky on mobile (design A3), inline on desktop */}
      <div className="fixed inset-x-0 bottom-0 border-t border-border bg-background/95 p-4 backdrop-blur lg:static lg:border-0 lg:bg-transparent lg:p-0">
        <div className="mx-auto flex max-w-160 items-center gap-3">
          <Button
            type="submit"
            variant="cta"
            size="lg"
            className="w-full"
            disabled={pending || !selected || overStock}
          >
            {pending ? 'Saving…' : 'Continue to payment'}
          </Button>
        </div>
      </div>
    </form>
  );
}

function FieldError({ children }: { children: React.ReactNode }) {
  return (
    <p className="text-sm leading-snug font-medium text-destructive" role="alert">
      {children}
    </p>
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
