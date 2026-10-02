'use server';

import { redirect } from 'next/navigation';
import { ordersService } from '@/server/container';
import { createRateLimiter, redisRateLimitStore } from '@/server/lib/rate-limit';
import { HUMAN_CHECK_FAILED, passesHumanCheck } from '@/lib/human-check';
import { requestIp } from '@/lib/request-ip';
import { findOrderSchema } from '@/lib/validation/orders';

export interface FindOrderState {
  error?: string;
  values?: { reference?: string; phone?: string };
}

// Each attempt is a guess at someone's phone number; keep them slow. A
// limiter outage lets the lookup through — it only reads Postgres.
const limiter = createRateLimiter(redisRateLimitStore(), { onError: 'allow' });
const FIND_LIMIT = { limit: 20, windowSeconds: 60 };

/**
 * Thin: Zod → human check → throttle → service → redirect to the order
 * page, or one generic refusal.
 */
export async function findOrderAction(
  _prev: FindOrderState,
  formData: FormData,
): Promise<FindOrderState> {
  const raw = {
    reference: formData.get('reference'),
    phone: formData.get('phone'),
  };
  const values = {
    reference: typeof raw.reference === 'string' ? raw.reference : '',
    phone: typeof raw.phone === 'string' ? raw.phone : '',
  };
  const parsed = findOrderSchema.safeParse(raw);
  if (!parsed.success)
    return { error: parsed.error.issues[0]?.message ?? 'Check the details.', values };

  // ADR-048: before the limiter, so a bot's guesses don't spend a real
  // buyer's per-IP budget on a shared network.
  if (!(await passesHumanCheck(formData, 'find-order')))
    return { error: HUMAN_CHECK_FAILED, values };

  const allowed = await limiter.allow([
    { scope: 'find-order:ip', subject: await requestIp(), ...FIND_LIMIT },
  ]);
  if (!allowed) return { error: 'Too many attempts. Please wait a minute and try again.', values };

  const order = await ordersService.findByReferenceAndPhone(
    parsed.data.reference,
    parsed.data.phone,
  );
  // One message for "no such reference" and "wrong phone": the reference is
  // not a secret, but which phone it belongs to is.
  if (!order) {
    return {
      error:
        'No order matches that reference and phone number. Check both — the reference is on your bKash payment and in the email we sent.',
      values,
    };
  }
  redirect(`/orders/${order.id}`);
}
