'use server';

import { redirect } from 'next/navigation';
import { settingsService } from '@/server/container';
import { logger } from '@/server/lib/logger';
import { requireAdmin } from '@/lib/session';
import { settingsFormSchema } from '@/lib/validation/settings';

/** What the form submits, as strings — the shape it re-seeds from on error. */
export interface SettingsFormValues {
  bkashReceiveNumber: string;
  bkashAccountName: string;
  bkashAccountType: string;
  supportEmail: string;
  supportPhone: string;
  facebookPageUrl: string;
  verificationPromise: string;
  organizerName: string;
  organizerAddress: string;
}

export interface SettingsFormState {
  error?: string;
  /** Which field the error is about, for the inline mark. */
  field?: keyof SettingsFormValues;
  /** The submission that failed, so a validation error never wipes the organizer's input. */
  values?: SettingsFormValues;
}

const FIELDS: (keyof SettingsFormValues)[] = [
  'bkashReceiveNumber',
  'bkashAccountName',
  'bkashAccountType',
  'supportEmail',
  'supportPhone',
  'facebookPageUrl',
  'verificationPromise',
  'organizerName',
  'organizerAddress',
];

function submittedValues(formData: FormData): SettingsFormValues {
  const out = {} as SettingsFormValues;
  for (const key of FIELDS) {
    const v = formData.get(key);
    out[key] = typeof v === 'string' ? v : '';
  }
  return out;
}

/** B14 Save. Thin: session → Zod → settingsService.update → back with ?saved=1. */
export async function saveSettingsAction(
  _prev: SettingsFormState,
  formData: FormData,
): Promise<SettingsFormState> {
  // Session first, like every admin action: the validator is not a public endpoint.
  const admin = await requireAdmin();
  const values = submittedValues(formData);
  const parsed = settingsFormSchema.safeParse(values);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    const path = issue?.path[0];
    return {
      error: issue?.message ?? 'Invalid input',
      field: FIELDS.find((f) => f === path),
      values,
    };
  }

  try {
    await settingsService.update(parsed.data, admin.email);
  } catch (err: unknown) {
    const shape =
      err instanceof Error ? { name: err.name, message: err.message } : { value: String(err) };
    logger.error({ err: shape }, 'settings: save failed');
    return { error: 'Could not save — nothing was changed. Please try again.', values };
  }
  redirect('/admin/settings?saved=1');
}
