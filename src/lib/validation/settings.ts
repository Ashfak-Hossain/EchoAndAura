import { z } from 'zod';
import { bkashAccountType } from '@/db/schema';
import { bdMobile } from './orders';

/**
 * B14 settings form. Every field is quoted somewhere a buyer can see, so the
 * rules are about what reads well there: numbers in the "01712 345678" form
 * people copy into bKash, a promise short enough for one sentence, an
 * https Facebook link. A blank optional field stores NULL — "none" (hide
 * the link, no phone), never an empty string. The promise and the organizer
 * name are always quoted in copy, so they are required.
 */
export const VERIFICATION_PROMISE_MAX = 80;
export const ORGANIZER_NAME_MAX = 60;
export const ORGANIZER_ADDRESS_MAX = 200;
export const ACCOUNT_NAME_MAX = 80;

/** E.164 `+8801712345678` → the display form `01712 345678`. Only for `bdMobile` output. */
export function formatBdMobile(e164: string): string {
  if (!/^\+8801[3-9]\d{8}$/.test(e164)) throw new Error(`not a BD mobile in E.164: ${e164}`);
  const local = `0${e164.slice(4)}`;
  return `${local.slice(0, 5)} ${local.slice(5)}`;
}

/** A BD mobile in any accepted form, stored in the display form. */
const displayMobile = bdMobile.transform(formatBdMobile);

/** "" → null: a cleared optional field is stored as NULL ("none"). */
const blankToNull = <T extends z.ZodType>(schema: T) =>
  z.preprocess((v) => (typeof v === 'string' && v.trim() === '' ? null : v), schema.nullable());

export const settingsFormSchema = z.object({
  bkashReceiveNumber: blankToNull(displayMobile),
  bkashAccountName: blankToNull(
    z
      .string()
      .trim()
      .min(2, { error: 'Enter the name on the bKash account.' })
      .max(ACCOUNT_NAME_MAX, { error: 'Account name is too long.' }),
  ),
  bkashAccountType: z.enum(bkashAccountType.enumValues, { error: 'Choose an account type.' }),
  supportEmail: blankToNull(
    z
      .string()
      .trim()
      .pipe(z.email({ error: 'Enter a valid email address.' })),
  ),
  supportPhone: blankToNull(displayMobile),
  facebookPageUrl: blankToNull(
    z
      .string()
      .trim()
      .pipe(z.url({ protocol: /^https$/, error: 'Enter the full https:// Facebook link.' })),
  ),
  verificationPromise: z
    .string()
    .trim()
    .min(3, { error: 'Say how quickly payments are checked.' })
    .max(VERIFICATION_PROMISE_MAX, {
      error: `Keep the promise under ${VERIFICATION_PROMISE_MAX} characters.`,
    }),
  organizerName: z
    .string()
    .trim()
    .min(2, { error: 'Enter the organizer name.' })
    .max(ORGANIZER_NAME_MAX, { error: 'Organizer name is too long.' }),
  organizerAddress: blankToNull(
    z.string().trim().max(ORGANIZER_ADDRESS_MAX, { error: 'Address is too long.' }),
  ),
});

export type SettingsFormInput = z.infer<typeof settingsFormSchema>;
