import { z } from 'zod';
import { sponsorLevel, sponsorTileTone } from '@/db/schema';
import {
  SPONSOR_LOGO_MAX_BYTES,
  SPONSOR_LOGO_TYPES,
  type SponsorLogoContentType,
} from '@/server/lib/sponsor-logo';

/**
 * B15 "Add sponsor" / edit form, and the list's row controls. The name is
 * the logo's accessible label, so it is required; a blank website stores
 * NULL (the logo is shown without a link), never an empty string. The logo
 * file gets a cheap first gate here — type and size, before its bytes are
 * read — and the service inspects the bytes themselves (`inspectLogo`).
 */
export const SPONSOR_NAME_MAX = 80;
export const SPONSOR_WEBSITE_MAX = 500;
/** The display order field's bounds; the service clamps to the level's size. */
export const SPONSOR_POSITION_MAX = 999;

/** "" → null: a cleared optional field is stored as NULL ("none"). */
const blankToNull = <T extends z.ZodType>(schema: T) =>
  z.preprocess((v) => (typeof v === 'string' && v.trim() === '' ? null : v), schema.nullable());

const position = z
  .number({ error: 'Enter the display order as a whole number.' })
  .int({ error: 'Enter the display order as a whole number.' })
  .min(1, { error: `The display order is 1 to ${SPONSOR_POSITION_MAX}.` })
  .max(SPONSOR_POSITION_MAX, { error: `The display order is 1 to ${SPONSOR_POSITION_MAX}.` });

export const sponsorFormSchema = z.object({
  name: z
    .string({ error: 'Enter the sponsor’s name. It is read out by screen readers.' })
    .trim()
    .min(1, { error: 'Enter the sponsor’s name. It is read out by screen readers.' })
    .max(SPONSOR_NAME_MAX, { error: `Keep the name to ${SPONSOR_NAME_MAX} characters.` }),
  websiteUrl: blankToNull(
    z
      .string()
      .trim()
      .max(SPONSOR_WEBSITE_MAX, { error: 'That link is too long.' })
      .pipe(
        z.url({ protocol: /^https$/, error: 'Enter the full https:// link to their website.' }),
      ),
  ),
  level: z.enum(sponsorLevel.enumValues, {
    error: 'Choose Presenting partner, Partner or Supporter.',
  }),
  tileTone: z.enum(sponsorTileTone.enumValues, { error: 'Choose a Light or Dark tile.' }),
  active: z.boolean().default(false),
  // A blank field means "where it is now" (or the end, for a new sponsor).
  position: z.preprocess(
    (v) => (typeof v === 'string' ? (v.trim() === '' ? undefined : Number(v.trim())) : v),
    position.optional(),
  ),
});

export type SponsorFormInput = z.infer<typeof sponsorFormSchema>;

/** FormData → the plain object the schema expects. The logo is read separately (`checkLogoFile`). */
export function sponsorFormValues(formData: FormData): Record<string, unknown> {
  const str = (key: string) => {
    const v = formData.get(key);
    return typeof v === 'string' ? v : undefined;
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

/** For the file input's `accept`. */
export const SPONSOR_LOGO_ACCEPT = [...Object.keys(SPONSOR_LOGO_TYPES), '.svg', '.png'].join(',');

export const LOGO_FILE_ERRORS = {
  required: 'Upload the sponsor’s logo as an SVG or PNG.',
  notFile: 'Choose the logo as a file.',
  empty: 'The logo file is empty.',
  size: 'The logo must be 512 KB or smaller.',
  type: 'The logo must be an SVG or PNG file.',
} as const;

export type LogoFileCheck =
  | { ok: true; file: null }
  | { ok: true; file: Blob; contentType: SponsorLogoContentType }
  | { ok: false; error: string };

function isLogoType(type: string): type is SponsorLogoContentType {
  return Object.prototype.hasOwnProperty.call(SPONSOR_LOGO_TYPES, type);
}

/**
 * The form's `logo` field. `file: null` when none was chosen — nothing
 * sent, or the nameless 0-byte file a blank file input submits — which is
 * an error only when `required` (a new sponsor). `contentType` is what to
 * hand the service: the browser's type without parameters, or, when the
 * browser sent none (some systems do not know .svg), the one the file
 * name implies.
 */
export function checkLogoFile(value: unknown, { required }: { required: boolean }): LogoFileCheck {
  const none = (): LogoFileCheck =>
    required ? { ok: false, error: LOGO_FILE_ERRORS.required } : { ok: true, file: null };
  if (value === null || value === undefined || value === '') return none();
  if (!(value instanceof Blob)) return { ok: false, error: LOGO_FILE_ERRORS.notFile };
  const name = value instanceof File ? value.name : '';
  if (value.size === 0 && name === '') return none();
  if (value.size === 0) return { ok: false, error: LOGO_FILE_ERRORS.empty };
  if (value.size > SPONSOR_LOGO_MAX_BYTES) return { ok: false, error: LOGO_FILE_ERRORS.size };
  const type = (value.type.split(';')[0] ?? '').trim().toLowerCase() || typeFromName(name);
  if (!isLogoType(type)) return { ok: false, error: LOGO_FILE_ERRORS.type };
  return { ok: true, file: value, contentType: type };
}

function typeFromName(name: string): string {
  const lower = name.toLowerCase();
  if (lower.endsWith('.svg')) return 'image/svg+xml';
  if (lower.endsWith('.png')) return 'image/png';
  return '';
}

/** Row controls on the B15 list: they send typed arguments, which are client input too. */
export const sponsorIdSchema = z.uuid();

export const sponsorActiveSchema = z.object({ id: z.uuid(), active: z.boolean() });

export const sponsorPositionSchema = z.object({ id: z.uuid(), position });
