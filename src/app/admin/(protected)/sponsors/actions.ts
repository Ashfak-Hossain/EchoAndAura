'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { sponsorsService } from '@/server/container';
import {
  SponsorLogoInvalidError,
  SponsorNotFoundError,
  SponsorPresentingConflictError,
} from '@/server/lib/errors';
import { logger } from '@/server/lib/logger';
import type { SponsorRecord } from '@/server/repositories/sponsors.repository';
import type { SponsorLogoUpload } from '@/server/services/sponsors.service';
import { requireAdmin } from '@/lib/session';
import {
  LOGO_FILE_ERRORS,
  checkLogoFile,
  sponsorActiveSchema,
  sponsorFormSchema,
  sponsorFormValues,
  sponsorIdSchema,
  sponsorPositionSchema,
} from '@/lib/validation/sponsors';

const PATH = '/admin/sponsors';

const GONE = 'This sponsor no longer exists.';
const PRESENTING_CONFLICT = 'Someone else just changed the presenting partner — reload.';

/** What the form submits, as strings — the shape it re-seeds from on error. */
export interface SponsorFormValues {
  name: string;
  websiteUrl: string;
  level: string;
  tileTone: string;
  active: boolean;
  position: string;
}

export type SponsorFormField = 'name' | 'websiteUrl' | 'level' | 'tileTone' | 'position' | 'logo';

export interface SponsorFormState {
  /**
   * New on every failed submit, so the same error said twice is still
   * announced, and a logo error can be dismissed by choosing another file.
   */
  nonce?: string;
  error?: string;
  /** Which field the error is about, for the inline mark. */
  field?: SponsorFormField;
  values?: SponsorFormValues;
}

const FIELDS = ['name', 'websiteUrl', 'level', 'tileTone', 'position'] as const;

function fail(state: Omit<SponsorFormState, 'nonce'>): SponsorFormState {
  return { ...state, nonce: crypto.randomUUID() };
}

function submitted(formData: FormData): SponsorFormValues {
  const str = (key: string) => {
    const v = formData.get(key);
    return typeof v === 'string' ? v : '';
  };
  return {
    name: str('name'),
    websiteUrl: str('websiteUrl'),
    level: str('level'),
    tileTone: str('tileTone'),
    active: formData.get('active') === 'on',
    position: str('position'),
  };
}

/**
 * Sponsors show in the footer of every public page, not only on the home
 * page, so the whole tree drops its cached payload (the admin list included).
 */
function revalidateSponsors(): void {
  revalidatePath('/', 'layout');
}

/**
 * B15 Add sponsor / Save changes. Thin: session → Zod → logo file gate →
 * service → back to the list with a banner. `editId` is bound by the page
 * (null = a new sponsor); a logo is required only for a new one. The form
 * calls this through a transition (not `<form action>`), so React never
 * resets the fields or drops the chosen file.
 */
export async function saveSponsorAction(
  editId: string | null,
  _prev: SponsorFormState,
  formData: FormData,
): Promise<SponsorFormState> {
  const admin = await requireAdmin();
  // Bound arguments are client input too.
  if (editId !== null && !sponsorIdSchema.safeParse(editId).success) return fail({ error: GONE });
  const values = submitted(formData);
  const parsed = sponsorFormSchema.safeParse(sponsorFormValues(formData));
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    return fail({
      error: issue?.message ?? 'Check the form.',
      field: FIELDS.find((f) => f === issue?.path[0]),
      values,
    });
  }
  const file = checkLogoFile(formData.get('logo'), { required: editId === null });
  if (!file.ok) return fail({ error: file.error, field: 'logo', values });
  const logo: SponsorLogoUpload | undefined = file.file
    ? { bytes: new Uint8Array(await file.file.arrayBuffer()), contentType: file.contentType }
    : undefined;

  let saved: SponsorRecord;
  try {
    if (editId) {
      saved = await sponsorsService.update(editId, { ...parsed.data, logo }, admin.email);
    } else {
      // checkLogoFile({ required: true }) never passes without a file.
      if (!logo) return fail({ error: LOGO_FILE_ERRORS.required, field: 'logo', values });
      saved = await sponsorsService.create({ ...parsed.data, logo }, admin.email);
    }
  } catch (err: unknown) {
    // The screen's own sentence says what to change in the export.
    if (err instanceof SponsorLogoInvalidError) {
      return fail({ error: err.reason, field: 'logo', values });
    }
    if (err instanceof SponsorPresentingConflictError) {
      return fail({ error: PRESENTING_CONFLICT, field: 'level', values });
    }
    if (err instanceof SponsorNotFoundError) return fail({ error: GONE, values });
    logger.error({ err: errShape(err) }, 'sponsors: save failed');
    return fail({ error: 'Could not save — nothing was changed. Please try again.', values });
  }
  revalidateSponsors();
  redirect(`${PATH}?saved=${encodeURIComponent(saved.name)}`);
}

export type RowActionResult = { ok: true } | { ok: false; error: string };

/** B15 Active switch. Hidden sponsors are kept, just not shown on the site. */
export async function setSponsorActiveAction(
  id: string,
  active: boolean,
): Promise<RowActionResult> {
  const admin = await requireAdmin();
  const args = sponsorActiveSchema.safeParse({ id, active });
  if (!args.success) return { ok: false, error: GONE };
  try {
    await sponsorsService.setActive(args.data.id, args.data.active, admin.email);
  } catch (err: unknown) {
    if (err instanceof SponsorNotFoundError) return { ok: false, error: GONE };
    logger.error({ err: errShape(err) }, 'sponsors: switch failed');
    return { ok: false, error: 'Could not change it. Please try again.' };
  }
  revalidateSponsors();
  return { ok: true };
}

/** B15 ▲ / ▼ / display order: the place within the level (the service clamps it). */
export async function setSponsorPositionAction(
  id: string,
  position: number,
): Promise<RowActionResult> {
  const admin = await requireAdmin();
  const args = sponsorPositionSchema.safeParse({ id, position });
  if (!args.success) {
    return {
      ok: false,
      error: sponsorIdSchema.safeParse(id).success
        ? (args.error.issues[0]?.message ?? 'Check the display order.')
        : GONE,
    };
  }
  try {
    await sponsorsService.setPosition(args.data.id, args.data.position, admin.email);
  } catch (err: unknown) {
    if (err instanceof SponsorNotFoundError) return { ok: false, error: GONE };
    logger.error({ err: errShape(err) }, 'sponsors: move failed');
    return { ok: false, error: 'Could not move it. Please try again.' };
  }
  revalidateSponsors();
  return { ok: true };
}

/** Takes the logo and link off the site straight away; the logo file goes too. */
export async function deleteSponsorAction(id: string): Promise<RowActionResult> {
  const admin = await requireAdmin();
  if (!sponsorIdSchema.safeParse(id).success) return { ok: false, error: GONE };
  try {
    await sponsorsService.delete(id, admin.email);
  } catch (err: unknown) {
    if (err instanceof SponsorNotFoundError) return { ok: false, error: GONE };
    logger.error({ err: errShape(err) }, 'sponsors: delete failed');
    return { ok: false, error: 'Could not delete it. Please try again.' };
  }
  revalidateSponsors();
  return { ok: true };
}

function errShape(err: unknown) {
  return err instanceof Error ? { name: err.name, message: err.message } : { value: String(err) };
}
