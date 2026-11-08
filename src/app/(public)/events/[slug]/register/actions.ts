'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { getLocale } from 'next-intl/server';
import { ordersService, type PromoCheck } from '@/server/container';
import { PromoCodeNotValidError, SoldOutError } from '@/server/lib/errors';
import { createRateLimiter, redisRateLimitStore } from '@/server/lib/rate-limit';
import { localisedPath } from '@/i18n/locales';
import type { FormError } from '@/lib/form-error-text';
import { passesHumanCheck } from '@/lib/human-check';
import { requestIp } from '@/lib/request-ip';
import { fieldErrorsOf } from '@/lib/validation/form-errors';
import { registrationFormSchema, registrationFormValues } from '@/lib/validation/orders';
import { promoCheckSchema } from '@/lib/validation/promo-codes';
import { promoFieldError, type RegisterBanner, registerBanner } from './errors';

// L3: every message is a code; the form words it in the page's language.
export interface RegistrationFormState {
  /** Field-level errors keyed by field name (attendee names as `attendeeNames.N`). */
  fieldErrors?: Record<string, FormError>;
  /** A banner above the form: sold out, window closed, or an outage. */
  banner?: RegisterBanner;
  /** What was submitted, so the form re-seeds instead of wiping the buyer's input. */
  values?: Record<string, unknown>;
}

// Every code check — Apply, or a submit that carries a code — is a guess at
// a code, so both share one budget per IP. Otherwise submitting against a
// sold-out ticket type would be an unthrottled way to test codes (found in
// review). A limiter outage lets the check through: it only reads Postgres.
const promoLimiter = createRateLimiter(redisRateLimitStore(), { onError: 'allow' });
const PROMO_LIMIT = { limit: 20, windowSeconds: 60 };
const TOO_MANY: FormError = { code: 'tooManyTries' };

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
  if (!parsed.success) return { fieldErrors: fieldErrorsOf(parsed.error), values };

  // ADR-048: before the limiters, so a bot neither spends a real buyer's
  // per-network budget nor holds seats. The buyer's input stays.
  if (!(await passesHumanCheck(formData, 'register'))) {
    return { banner: { code: 'humanCheck' }, values };
  }

  if (parsed.data.promoCode && !(await promoCheckAllowed())) {
    return { fieldErrors: { promoCode: TOO_MANY }, values };
  }

  if (!(await orderAllowed())) {
    return { banner: { code: 'tooManyOrders' }, values };
  }

  // The proxy's header, never the form: a /bn page posts to its /bn path.
  const locale = await getLocale();
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
        locale,
      })
    ).id;
  } catch (err: unknown) {
    // A code that stopped applying is the buyer's field, not a banner: their
    // input stays, and nothing was held.
    if (err instanceof PromoCodeNotValidError) {
      return { fieldErrors: { promoCode: promoFieldError(err.reason) }, values };
    }
    // Fewer seats than the page showed: re-render it with today's numbers,
    // so the form never says "3 left" beside "not that many are left".
    if (err instanceof SoldOutError) revalidatePath(`/events/${eventSlug}/register`);
    const banner = registerBanner(err);
    // Infrastructure failure — never disguise it as the buyer's mistake.
    if (banner.code === 'unexpected') console.error('register action: unexpected error', err);
    return { banner, values };
  }

  // Into the order page in the language the buyer registered in.
  redirect(localisedPath(`/orders/${orderId}`, locale));
}

export type PromoCheckResult =
  PromoCheck | { ok: false; reason: 'invalid_input' | 'throttled' | 'unavailable' };

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
  if (!parsed.success) return { ok: false, reason: 'invalid_input' };
  if (!(await promoCheckAllowed())) return { ok: false, reason: 'throttled' };
  try {
    return await ordersService.checkPromo(
      parsed.data.eventSlug,
      parsed.data.code,
      parsed.data.ticketTypeId,
    );
  } catch (err: unknown) {
    // An outage must not blank the form the buyer has been filling in.
    console.error('checkPromoCodeAction: unexpected error', err);
    return { ok: false, reason: 'unavailable' };
  }
}
