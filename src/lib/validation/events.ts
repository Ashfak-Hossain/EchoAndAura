import { z } from 'zod';
import { SLUG_MAX_LENGTH, SLUG_PATTERN } from '@/server/lib/slug';
import { DATETIME_LOCAL_PATTERN, fromDhakaInput } from '@/lib/time';

/**
 * Admin event form input. HTML forms submit every field as a string and an
 * untouched field as "" — so blanks are normalised to `undefined` here, and
 * cross-field date rules are checked at this boundary so the service only
 * ever sees a coherent event.
 */

const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .transform((v) => (v === '' ? undefined : v))
    .optional();

/** A datetime-local string interpreted as Dhaka wall time → Date. */
const dhakaDateTime = z
  .string({ error: 'Enter a date and time' })
  .trim()
  .regex(DATETIME_LOCAL_PATTERN, { error: 'Enter a valid date and time' })
  .transform((v, ctx) => {
    const date = fromDhakaInput(v);
    if (Number.isNaN(date.getTime())) {
      ctx.addIssue({ code: 'custom', message: 'Enter a valid date and time' });
      return z.NEVER;
    }
    return date;
  });

const optionalDhakaDateTime = z
  .string()
  .trim()
  .transform((v) => (v === '' ? undefined : v))
  .optional()
  .pipe(dhakaDateTime.optional());

export const eventFormSchema = z
  .object({
    title: z
      .string({ error: 'Title is required' })
      .trim()
      .min(1, { error: 'Title is required' })
      .max(200, { error: 'Title must be at most 200 characters' }),
    slug: z
      .string()
      .trim()
      .toLowerCase()
      .transform((v) => (v === '' ? undefined : v))
      .optional()
      .pipe(
        z
          .string()
          .max(SLUG_MAX_LENGTH, {
            error: `Slug must be at most ${SLUG_MAX_LENGTH} characters`,
          })
          .regex(SLUG_PATTERN, {
            error: 'Slug may contain only lowercase letters, numbers and single dashes',
          })
          .optional(),
      ),
    // HTML from the rich-text editor (ADR-010) is ~3–5× the visible text.
    description: optionalText(50_000),
    venue: optionalText(300),
    startsAt: dhakaDateTime,
    endsAt: optionalDhakaDateTime,
    registrationOpensAt: optionalDhakaDateTime,
    registrationClosesAt: optionalDhakaDateTime,
  })
  .superRefine((v, ctx) => {
    if (v.endsAt && v.endsAt <= v.startsAt) {
      ctx.addIssue({
        code: 'custom',
        path: ['endsAt'],
        message: 'End must be after start',
      });
    }
    if (v.registrationOpensAt && v.registrationClosesAt) {
      if (v.registrationOpensAt >= v.registrationClosesAt) {
        ctx.addIssue({
          code: 'custom',
          path: ['registrationOpensAt'],
          message: 'Registration must open before it closes',
        });
      }
    }
    if (v.registrationClosesAt && v.registrationClosesAt > v.startsAt) {
      ctx.addIssue({
        code: 'custom',
        path: ['registrationClosesAt'],
        message: 'Registration must close on or before the event start',
      });
    }
  });

export type EventFormInput = z.infer<typeof eventFormSchema>;
