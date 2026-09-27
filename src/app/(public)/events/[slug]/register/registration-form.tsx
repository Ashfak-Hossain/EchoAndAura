'use client';

import Link from 'next/link';
import { Check, Minus, Plus } from 'lucide-react';
import { useActionState, useEffect, useMemo, useRef, useState, useTransition } from 'react';
import { MAX_TICKETS_PER_ORDER } from '@/server/lib/order-rules';
import { promoAppliesTo, promoDiscountPaisa, promoDiscountPerTicket } from '@/server/lib/promo';
import { Button } from '@/components/button';
import { FieldHint } from '@/components/form-field';
import { Money } from '@/components/money';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { BD_MOBILE_PREFIX } from '@/lib/validation/orders';
import { cn } from '@/lib/utils';
import type { PromoCheckResult, RegistrationFormState } from './actions';

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
  /** B10 "Apply": bound to this event on the page. */
  checkPromo: (input: { code: string; ticketTypeId: string }) => Promise<PromoCheckResult>;
  options: TicketOption[];
  registrationClosesAt: string | null;
  /** From the buyer's session, when signed in. */
  prefill?: { name: string; email: string } | null;
}

const str = (v: unknown) => (typeof v === 'string' ? v : '');

/**
 * A3 registration form: ticket radio group, quantity stepper, buyer details,
 * one attendee name per ticket, order summary, terms. The summary maths is
 * display only — the server recomputes every number from the ticket_types
 * row (Invariant 5) and re-checks stock atomically on submit.
 */
export function RegistrationForm({
  action,
  checkPromo,
  options,
  registrationClosesAt,
  prefill,
}: Props) {
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

  const [buyerName, setBuyerName] = useState(str(values.buyerName) || (prefill?.name ?? ''));

  // Failed submit: focus moves to the summary (design A3 · validation errors).
  const summaryRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (errorCount > 0 || state.banner) summaryRef.current?.focus();
  }, [errorCount, state.banner]);

  const subtotal = useMemo(
    () => (selected ? selected.pricePaisa * quantity : 0),
    [selected, quantity],
  );

  // B10 promo code. `applied` is what Apply learned from the server; the
  // discount below is a preview from the same pure rule the server uses —
  // the server prices the order again on submit (Invariant 5).
  const [promoInput, setPromoInput] = useState(str(values.promoCode));
  const [appliedResult, setApplied] = useState<{
    rule: Extract<PromoCheckResult, { ok: true }>;
    /** The action state it was applied against: a later submit that refuses the code wins. */
    at: RegistrationFormState;
  } | null>(null);
  const refusedOnSubmit = Boolean(errors.promoCode) && appliedResult?.at !== state;
  const applied = refusedOnSubmit ? null : (appliedResult?.rule ?? null);
  const [promoError, setPromoError] = useState<string | null>(null);
  const [checking, startCheck] = useTransition();
  // Mirrors the server's judgePromo for the chosen type: covered, and not
  // taking the whole price off (a ৳0 order cannot be paid by bKash).
  const promoCovers =
    applied !== null &&
    selected !== null &&
    promoAppliesTo(applied, selected.id) &&
    promoDiscountPerTicket(applied, selected.pricePaisa) < selected.pricePaisa;
  const discount =
    applied && selected && promoCovers
      ? Math.min(promoDiscountPaisa(applied, selected.pricePaisa, quantity), subtotal)
      : 0;
  const total = subtotal - discount;
  const promoFieldError = (refusedOnSubmit ? errors.promoCode : undefined) ?? promoError;

  const applyPromo = () => {
    if (checking) return;
    const code = promoInput.trim();
    if (!code) {
      setPromoError('Enter a code first.');
      return;
    }
    if (!selected) {
      setPromoError('Choose a ticket type first.');
      return;
    }
    setPromoError(null);
    startCheck(async () => {
      let result: PromoCheckResult;
      try {
        result = await checkPromo({ code, ticketTypeId: selected.id });
      } catch {
        // A dropped connection must not throw away the whole form.
        setPromoError('We could not check the code just now. Try again, or continue without it.');
        return;
      }
      if (result.ok) {
        setApplied({ rule: result, at: state });
        setPromoInput(result.code);
        return;
      }
      setApplied(null);
      setPromoError(
        'message' in result
          ? result.message
          : result.reason === 'unknown'
            ? 'That code is not valid for this event.'
            : `That code does not apply to ${selected.name} tickets.`,
      );
    });
  };

  const removePromo = () => {
    setApplied(null);
    setPromoError(null);
    setPromoInput('');
  };

  return (
    <form action={formAction} className="flex flex-col gap-8 pb-24 lg:pb-0" noValidate>
      {state.banner || errorCount > 0 ? (
        <div
          ref={summaryRef}
          tabIndex={-1}
          role="alert"
          className="flex flex-col gap-1 rounded-xl border border-l-4 border-destructive/30 border-l-destructive bg-destructive-tint px-4 py-3.5 outline-none"
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
                <span
                  className={cn(
                    'text-[13px]',
                    !disabled && o.available <= 10 && 'font-medium text-[#7a4600]',
                  )}
                >
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
            className="h-11 w-16 rounded-md border border-input bg-card text-center text-lg font-semibold tabular outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
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
          Tickets are emailed to this address once your payment is checked. Each ticket carries your
          name
          {registrationClosesAt
            ? ` — you can change it on the ticket until ${registrationClosesAt}`
            : ''}
          .
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
            defaultValue={str(values.buyerEmail) || (prefill?.email ?? '')}
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
            <span className="flex items-center rounded-l-md border border-r-0 border-input bg-secondary px-3 text-[15px] text-muted-foreground tabular">
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
              className="h-11 rounded-l-none bg-card tabular"
            />
          </div>
          {errors.buyerPhone ? (
            <FieldError>{errors.buyerPhone}</FieldError>
          ) : (
            <FieldHint>The number you will send the bKash payment from.</FieldHint>
          )}
        </div>
      </fieldset>

      {/* Promo code (B10) */}
      <div className="flex flex-col gap-2">
        <Label htmlFor="promoCode">
          Promo code <span className="font-normal text-muted-foreground">· optional</span>
        </Label>
        {applied ? (
          <div
            className={cn(
              'flex items-center justify-between gap-3 rounded-md border px-3 py-2.5 text-[15px]',
              promoCovers
                ? 'border-[#bfe0cd] bg-success-tint text-[#17603b]'
                : 'border-border-strong bg-secondary text-muted-foreground',
            )}
            data-testid="promo-applied"
          >
            <span className="flex items-center gap-2 font-medium">
              <Check className="size-4 shrink-0" aria-hidden="true" />
              {promoCovers
                ? `${applied.code} applied — ${applied.label}`
                : `${applied.code} does not apply to ${selected?.name ?? 'this'} tickets`}
            </span>
            <button
              type="button"
              onClick={removePromo}
              className="text-sm font-semibold underline underline-offset-2"
            >
              Remove
            </button>
            {/* Only a code that covers the chosen ticket is sent; the server decides. */}
            {promoCovers ? <input type="hidden" name="promoCode" value={applied.code} /> : null}
          </div>
        ) : (
          <div className="flex items-stretch gap-2">
            {/* Named, so a code typed but never applied is still checked on submit
                — it either applies or comes back as an error, never silently ignored. */}
            <Input
              id="promoCode"
              name="promoCode"
              value={promoInput}
              onChange={(e) => {
                setPromoInput(e.target.value.toUpperCase());
                setPromoError(null);
              }}
              onKeyDown={(e) => {
                // Enter applies the code instead of submitting the whole form.
                if (e.key === 'Enter') {
                  e.preventDefault();
                  applyPromo();
                }
              }}
              autoComplete="off"
              autoCapitalize="characters"
              spellCheck={false}
              aria-invalid={Boolean(promoFieldError)}
              aria-describedby={promoFieldError ? 'promoCode-error' : undefined}
              className="h-11 bg-card font-mono tracking-wide uppercase"
            />
            <Button
              type="button"
              variant="secondary"
              className="h-11 shrink-0 px-5"
              onClick={applyPromo}
              disabled={checking}
            >
              {checking ? 'Checking…' : 'Apply'}
            </Button>
          </div>
        )}
        {promoFieldError ? (
          <p
            id="promoCode-error"
            className="text-sm leading-snug font-medium text-destructive"
            role="alert"
          >
            {promoFieldError}
          </p>
        ) : null}
      </div>

      {/* Summary */}
      <section
        aria-labelledby="summary-heading"
        className="flex flex-col gap-2.5 rounded-xl border border-border bg-card p-4"
      >
        <h2
          id="summary-heading"
          className="font-sans text-xs font-medium tracking-widest text-muted-foreground uppercase"
        >
          Order summary
        </h2>
        <dl className="flex flex-col gap-1.5 text-[15px]">
          <div className="flex justify-between gap-4">
            <dt>{selected ? `${selected.name} × ${quantity}` : 'No ticket chosen'}</dt>
            <dd>
              <Money paisa={subtotal} />
            </dd>
          </div>
          {discount > 0 && applied ? (
            <div
              className="flex justify-between gap-4 text-[#17603b]"
              data-testid="summary-discount"
            >
              <dt>Discount · {applied.code}</dt>
              <dd>
                −<Money paisa={discount} />
              </dd>
            </div>
          ) : null}
          <div className="flex justify-between gap-4 border-t border-border pt-2 text-lg font-semibold">
            <dt>Total</dt>
            <dd data-testid="summary-total">
              <Money paisa={total} />
            </dd>
          </div>
        </dl>
        <p className="text-[13px] leading-snug text-muted-foreground">
          The final price is confirmed by our server when you submit, so what you pay always matches
          what you see here.
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
          <span>
            I agree to the{' '}
            <Link href="/terms" target="_blank" rel="noreferrer" className="underline">
              terms
            </Link>{' '}
            and understand that payments are checked by hand and there are{' '}
            <Link href="/refund" target="_blank" rel="noreferrer" className="underline">
              no refunds in the app
            </Link>
            .
          </span>
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
