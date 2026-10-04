'use server';

import { redirect } from 'next/navigation';
import { ordersService, type PromoCheck } from '@/server/container';
import {
  EventNotFoundError,
  InvalidQuantityError,
  PromoCodeNotValidError,
  RegistrationClosedError,
  SoldOutError,
  TicketTypeNotFoundError,
  TicketTypeNotOnSaleError,
  TooManyOpenOrdersError,
} from '@/server/lib/errors';
import { HOLD_MINUTES } from '@/server/lib/hold';
import { createRateLimiter, redisRateLimitStore } from '@/server/lib/rate-limit';
import { HUMAN_CHECK_FAILED, passesHumanCheck } from '@/lib/human-check';
import { requestIp } from '@/lib/request-ip';
import { registrationFormSchema, registrationFormValues } from '@/lib/validation/orders';
import { promoCheckSchema } from '@/lib/validation/promo-codes';

export interface RegistrationFormState {
  /** Field-level messages keyed by field name (attendee names as `attendeeNames.N`). */
  fieldErrors?: Record<string, string>;
  /** A banner above the form: sold out, window closed, or an outage. */
  banner?: { title: string; body: string; soldOutTicketTypeId?: string };
  /** What was submitted, so the form re-seeds instead of wiping the buyer's input. */
  values?: Record<string, unknown>;
}

// Every code check — Apply, or a submit that carries a code — is a guess at
// a code, so both share one budget per IP. Otherwise submitting against a
// sold-out ticket type would be an unthrottled way to test codes (found in
// review). A limiter outage lets the check through: it only reads Postgres.
const promoLimiter = createRateLimiter(redisRateLimitStore(), { onError: 'allow' });
const PROMO_LIMIT = { limit: 20, windowSeconds: 60 };
const TOO_MANY = 'Too many tries. Please wait a minute and try again.';

// Phase 7.6: every order holds seats (20 minutes, ADR-054), so placing them is
// throttled per network too (the service also caps open orders per phone).
// Generous on purpose: Bangladeshi mobile carriers put many buyers behind
// one address (CGNAT). A limiter outage lets the order through; the
// per-phone cap still holds. Off for the e2e suite (APP_ENV=test), which
// registers from one address all run, like the sign-in limiter.
const orderLimiter = createRateLimiter(redisRateLimitStore(), { onError: 'allow' });
const ORDER_LIMIT = { limit: 20, windowSeconds: 15 * 60 };

async function orderAllowed(): Promise<boolean> {
  if (process.env.APP_ENV === 'test') return true;
  return orderLimiter.allow([
    { scope: 'order-create:ip', subject: await requestIp(), ...ORDER_LIMIT },
  ]);
}

async function promoCheckAllowed(): Promise<boolean> {
  return promoLimiter.allow([
    { scope: 'promo-check:ip', subject: await requestIp(), ...PROMO_LIMIT },
  ]);
}

/** Thin: Zod parse → human check → limiters → service → redirect to the order page. */
export async function registerAction(
  eventSlug: string,
  _prev: RegistrationFormState,
  formData: FormData,
): Promise<RegistrationFormState> {
  const values = registrationFormValues(formData);
  const parsed = registrationFormSchema.safeParse(values);
  if (!parsed.success) {
    const fieldErrors: Record<string, string> = {};
    for (const issue of parsed.error.issues) {
      const key = issue.path.join('.');
      fieldErrors[key] ??= issue.message;
    }
    return { fieldErrors, values };
  }

  // ADR-048: before the limiters, so a bot neither spends a real buyer's
  // per-network budget nor holds seats. The buyer's input stays.
  if (!(await passesHumanCheck(formData, 'register'))) {
    return { banner: { title: 'Your order was not placed', body: HUMAN_CHECK_FAILED }, values };
  }

  if (parsed.data.promoCode && !(await promoCheckAllowed())) {
    return { fieldErrors: { promoCode: TOO_MANY }, values };
  }

  if (!(await orderAllowed())) {
    return {
      banner: {
        title: 'Too many orders from this network',
        body: 'Please wait a few minutes and try again. Nothing has been charged.',
      },
      values,
    };
  }

  let orderId: string;
  try {
    const d = parsed.data;
    orderId = (
      await ordersService.createOrder({
        eventSlug,
        ticketTypeId: d.ticketTypeId,
        quantity: d.quantity,
        buyerName: d.buyerName,
        buyerEmail: d.buyerEmail,
        buyerPhone: d.buyerPhone,
        attendeeNames: d.attendeeNames,
        promoCode: d.promoCode,
      })
    ).id;
  } catch (err: unknown) {
    // A code that stopped applying is the buyer's field, not a banner: their
    // input stays, and nothing was held.
    if (err instanceof PromoCodeNotValidError) {
      return { fieldErrors: { promoCode: promoMessage(err.reason) }, values };
    }
    return { banner: toBanner(err), values };
  }

  redirect(`/orders/${orderId}`);
}

/** Buyer-facing words for a code that cannot be used (design A3). */
function promoMessage(reason: PromoCodeNotValidError['reason']): string {
  return reason === 'unknown'
    ? 'That code is not valid for this event.'
    : 'That code does not apply to the ticket type you chose.';
}

export type PromoCheckResult =
  | PromoCheck
  | { ok: false; reason: 'invalid_input' | 'throttled' | 'unavailable'; message: string };

/**
 * B10 "Apply" on A3. Read-only: tells the form whether the code applies and
 * how, so it can show the discount before submit. The order is priced again
 * on the server when it is placed (Invariant 5), whatever this returned.
 */
export async function checkPromoCodeAction(
  eventSlug: string,
  input: { code: string; ticketTypeId: string },
): Promise<PromoCheckResult> {
  // Arguments of a server action are client input like any form field.
  const parsed = promoCheckSchema.safeParse({ ...input, eventSlug });
  if (!parsed.success) {
    return {
      ok: false,
      reason: 'invalid_input',
      message: parsed.error.issues[0]?.message ?? 'That code is not valid for this event.',
    };
  }
  if (!(await promoCheckAllowed())) return { ok: false, reason: 'throttled', message: TOO_MANY };
  try {
    return await ordersService.checkPromo(
      parsed.data.eventSlug,
      parsed.data.code,
      parsed.data.ticketTypeId,
    );
  } catch (err: unknown) {
    // An outage must not blank the form the buyer has been filling in.
    console.error('checkPromoCodeAction: unexpected error', err);
    return {
      ok: false,
      reason: 'unavailable',
      message: 'We could not check the code just now. Try again, or continue without it.',
    };
  }
}

function toBanner(err: unknown): NonNullable<RegistrationFormState['banner']> {
  if (err instanceof SoldOutError) {
    return {
      title: 'That ticket type sold out while you were choosing',
      body: 'Nothing has been charged. Pick another ticket type or a smaller quantity to carry on.',
      soldOutTicketTypeId: err.ticketTypeId,
    };
  }
  if (err instanceof RegistrationClosedError || err instanceof EventNotFoundError) {
    return {
      title: 'Registration is not open',
      body: 'The registration window for this event has closed or has not opened yet.',
    };
  }
  if (err instanceof TicketTypeNotOnSaleError || err instanceof TicketTypeNotFoundError) {
    return {
      title: 'That ticket type is not on sale',
      body: 'Its sales window is over or has not started. Choose another ticket type.',
    };
  }
  if (err instanceof TooManyOpenOrdersError) {
    return {
      title: 'You already have orders waiting for this event',
      body: `This mobile number has ${err.limit} orders waiting for payment or checking. Pay for one, or let its ${HOLD_MINUTES}-minute hold end, before ordering again (an order already waiting for checking stays until the organizer answers). You can find them with Find my order.`,
    };
  }
  if (err instanceof InvalidQuantityError) {
    return {
      title: 'Choose between 1 and 10 tickets',
      body: 'One ticket type per order, up to 10.',
    };
  }
  // Infrastructure failure — never disguise it as the buyer's mistake.
  console.error('register action: unexpected error', err);
  return {
    title: 'We could not place your order',
    body: 'Nothing has been charged. Please try again in a moment.',
  };
}
