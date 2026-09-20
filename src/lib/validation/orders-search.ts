import { z } from 'zod';
import { orderStatus } from '@/db/schema';
import { ORDER_REFERENCE_PATTERN } from '@/server/lib/order-reference';
import { bdMobile } from './orders';

/**
 * B9 orders list: everything lives in the URL (`?q=&status=&event=&from=
 * &to=&page=`), so the schema is lenient — an unknown status or a bad
 * date falls back to "no filter" rather than a 400. `page` clamps to ≥ 1.
 */
const optionalEnum = <T extends readonly [string, ...string[]]>(values: T) =>
  z
    .string()
    .optional()
    .transform((v) => (v && (values as readonly string[]).includes(v) ? (v as T[number]) : null));

const isoDate = z
  .string()
  .optional()
  .transform((v) => (v && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : null));

export const ordersSearchSchema = z.object({
  q: z
    .string()
    .optional()
    .transform((v) => (v ?? '').trim().slice(0, 80)),
  status: optionalEnum(orderStatus.enumValues),
  event: z
    .string()
    .optional()
    .transform((v) => (v && z.uuid().safeParse(v).success ? v : null)),
  from: isoDate,
  to: isoDate,
  page: z
    .string()
    .optional()
    .transform((v) => {
      const n = Number.parseInt(v ?? '', 10);
      return Number.isFinite(n) && n >= 1 ? n : 1;
    }),
});

export type OrdersSearchInput = z.infer<typeof ordersSearchSchema>;

/** The fields a search term can match, in the order they are tried. */
export type MatchedField = 'reference' | 'trxId' | 'phone' | 'email';

export interface SearchTerm {
  /** `EA-XXXXXX` when the term looks like a reference (with or without `EA-`). */
  reference: string | null;
  /** Ten upper-case letters/digits when the term looks like a trxID. */
  trxId: string | null;
  /** E.164 `+880…` when the term is a Bangladeshi mobile in any accepted form. */
  phone: string | null;
  /** Lower-cased substring; always set for a non-empty term. */
  email: string | null;
}

const TRX_ID = /^[A-Z0-9]{10}$/;

/**
 * Normalise a free-text term the same way the data was stored (uppercase
 * reference and trxID, E.164 phone, lowercase email) so equality matches
 * work. A term can plausibly be several things at once — "9AB12CD34E" is
 * a trxID and also an email substring — so every interpretation that
 * parses is returned and the repository ORs them.
 */
export function normaliseSearchTerm(raw: string): SearchTerm {
  const term = raw.trim();
  if (!term) return { reference: null, trxId: null, phone: null, email: null };

  const upper = term.toUpperCase();
  const asReference = `EA-${upper.replace(/^EA-?/, '')}`;
  const reference = ORDER_REFERENCE_PATTERN.test(asReference) ? asReference : null;
  const trxId = TRX_ID.test(upper) ? upper : null;
  const phoneParse = bdMobile.safeParse(term);
  const phone = phoneParse.success ? phoneParse.data : null;
  const email = term.toLowerCase();

  return { reference, trxId, phone, email };
}
