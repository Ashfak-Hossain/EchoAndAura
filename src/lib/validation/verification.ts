import { z } from 'zod';
import { REJECTION_NOTE_MAX, REJECTION_REASON_CODES } from '@/server/lib/rejection-reasons';

/** B8 reject dialog: a reason from the fixed list, an optional note the buyer reads. */
export const rejectFormSchema = z.object({
  reason: z.enum(REJECTION_REASON_CODES, { error: 'Choose a reason.' }),
  note: z
    .string()
    .trim()
    .max(REJECTION_NOTE_MAX, { error: `Keep the note under ${REJECTION_NOTE_MAX} characters.` })
    .transform((v) => (v === '' ? undefined : v))
    .optional(),
});

export type RejectFormInput = z.infer<typeof rejectFormSchema>;
