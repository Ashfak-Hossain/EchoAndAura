'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { z } from 'zod';
import { promoCodesService } from '@/server/container';
import {
  PromoCodeInUseError,
  PromoCodeNotFoundError,
  PromoCodeTakenError,
  TicketTypeNotFoundError,
} from '@/server/lib/errors';
import { logger } from '@/server/lib/logger';
import { requireAdmin } from '@/lib/session';
import { promoCodeFormSchema, promoCodeFormValues } from '@/lib/validation/promo-codes';

const PATH = '/admin/promo-codes';

/** What the sheet submits, as strings — the shape it re-seeds from on error. */
export interface PromoCodeFormValues {
  code: string;
  type: string;
  value: string;
  /** 'all' = any ticket type; 'some' = only `ticketTypeIds`; '' = not chosen yet (a new code). */
  scope: 'all' | 'some' | '';
  ticketTypeIds: string[];
  active: boolean;
}

export interface PromoCodeFormState {
  /**
   * New on every failed submit. React 19 resets a form's DOM after an
   * action, which would desync its controlled radios/checkboxes; the form
   * remounts its fields on each new nonce, re-seeded from `values`.
   */
  nonce?: string;
  error?: string;
  /** Which field the error is about, for the inline mark. */
  field?: 'code' | 'type' | 'value' | 'scope' | 'ticketTypeIds';
  values?: PromoCodeFormValues;
}

const FIELDS = ['code', 'type', 'value', 'scope', 'ticketTypeIds'] as const;

function fail(state: Omit<PromoCodeFormState, 'nonce'>): PromoCodeFormState {
  return { ...state, nonce: crypto.randomUUID() };
}

function submitted(formData: FormData): PromoCodeFormValues {
  const raw = promoCodeFormValues(formData);
  return {
    code: typeof raw.code === 'string' ? raw.code : '',
    type: typeof raw.type === 'string' ? raw.type : 'percentage',
    value: typeof raw.value === 'string' ? raw.value : '',
    scope: raw.scope === 'some' || raw.scope === 'all' ? raw.scope : '',
    ticketTypeIds: Array.isArray(raw.ticketTypeIds) ? (raw.ticketTypeIds as string[]) : [],
    active: raw.active === true,
  };
}

/**
 * B10 Create / Save. Thin: session → Zod → service → back to the table with
 * a banner. `editId` is bound by the page (null = a new code). The code
 * text of an existing code is not editable — the form does not send it.
 */
export async function savePromoCodeAction(
  editId: string | null,
  _prev: PromoCodeFormState,
  formData: FormData,
): Promise<PromoCodeFormState> {
  const admin = await requireAdmin();
  // Bound arguments are client input too.
  if (editId !== null && !z.uuid().safeParse(editId).success) {
    return fail({ error: 'This code no longer exists.' });
  }
  const values = submitted(formData);
  const parsed = promoCodeFormSchema.safeParse(promoCodeFormValues(formData));
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    return fail({
      error: issue?.message ?? 'Check the form.',
      field: FIELDS.find((f) => f === issue?.path[0]),
      values,
    });
  }

  let code: string;
  try {
    const { code: typed, ...rest } = parsed.data;
    code = editId
      ? (await promoCodesService.update(editId, rest, admin.email)).code
      : (await promoCodesService.create({ code: typed, ...rest }, admin.email)).code;
  } catch (err: unknown) {
    if (err instanceof PromoCodeTakenError) {
      return fail({
        error: `${err.code} already exists — choose another code.`,
        field: 'code',
        values,
      });
    }
    if (err instanceof TicketTypeNotFoundError) {
      return fail({
        error: 'One of those ticket types no longer exists. Reload and choose again.',
        field: 'ticketTypeIds',
        values,
      });
    }
    if (err instanceof PromoCodeNotFoundError) {
      return fail({ error: 'This code no longer exists.', values });
    }
    logger.error({ err: errShape(err) }, 'promo codes: save failed');
    return fail({ error: 'Could not save — nothing was changed. Please try again.', values });
  }
  revalidatePath(PATH);
  redirect(`${PATH}?saved=${encodeURIComponent(code)}${editId ? '' : '&created=1'}`);
}

export type RowActionResult = { ok: true } | { ok: false; error: string };

/** B10 Active switch. Off stops new uses; orders already discounted keep their price. */
export async function setPromoActiveAction(id: string, active: boolean): Promise<RowActionResult> {
  const admin = await requireAdmin();
  const args = z.object({ id: z.uuid(), active: z.boolean() }).safeParse({ id, active });
  if (!args.success) return { ok: false, error: 'This code no longer exists.' };
  try {
    await promoCodesService.setActive(args.data.id, args.data.active, admin.email);
  } catch (err: unknown) {
    if (err instanceof PromoCodeNotFoundError)
      return { ok: false, error: 'This code no longer exists.' };
    logger.error({ err: errShape(err) }, 'promo codes: switch failed');
    return { ok: false, error: 'Could not change it. Please try again.' };
  }
  revalidatePath(PATH);
  return { ok: true };
}

/** Only for a code no order ever used; otherwise switch it off. */
export async function deletePromoCodeAction(id: string): Promise<RowActionResult> {
  const admin = await requireAdmin();
  if (!z.uuid().safeParse(id).success) return { ok: false, error: 'This code no longer exists.' };
  try {
    await promoCodesService.remove(id, admin.email);
  } catch (err: unknown) {
    if (err instanceof PromoCodeInUseError) {
      return {
        ok: false,
        error: 'Orders used this code, so it stays on record. Switch it off instead.',
      };
    }
    if (err instanceof PromoCodeNotFoundError)
      return { ok: false, error: 'This code no longer exists.' };
    logger.error({ err: errShape(err) }, 'promo codes: delete failed');
    return { ok: false, error: 'Could not delete it. Please try again.' };
  }
  revalidatePath(PATH);
  return { ok: true };
}

function errShape(err: unknown) {
  return err instanceof Error ? { name: err.name, message: err.message } : { value: String(err) };
}
