'use client';

import {
  type FormEvent,
  type ReactNode,
  startTransition,
  useActionState,
  useEffect,
  useRef,
  useState,
} from 'react';
import { sponsorLevel, sponsorTileTone } from '@/db/schema';
import { inspectLogo } from '@/server/lib/sponsor-logo';
import type { SponsorLevel, SponsorTileTone } from '@/server/repositories/sponsors.repository';
import { Button } from '@/components/button';
import { ButtonLink } from '@/components/button-link';
import { FieldHint, FormAlert } from '@/components/form-field';
import { SegmentedControl } from '@/components/segmented-control';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { SPONSOR_LEVEL_LABELS, SPONSOR_TILE_LABELS } from '@/lib/sponsor-levels';
import { cn } from '@/lib/utils';
import {
  LOGO_FILE_ERRORS,
  SPONSOR_LOGO_ACCEPT,
  SPONSOR_NAME_MAX,
  checkLogoFile,
} from '@/lib/validation/sponsors';
import type { SponsorFormField, SponsorFormState } from './actions';
import { DeleteSponsorButton } from './delete-sponsor';
import { type PreviewLogo, SponsorPreview } from './sponsor-preview';

export interface SponsorFormInitial {
  name: string;
  websiteUrl: string;
  level: SponsorLevel;
  tileTone: SponsorTileTone;
  active: boolean;
  /** The sponsor's place in its level; '' for a new sponsor (the form picks the end). */
  position: string;
}

interface Props {
  action: (prev: SponsorFormState, formData: FormData) => Promise<SponsorFormState>;
  initial: SponsorFormInitial;
  /** Editing: the sponsor as stored, logo included. */
  sponsor: { id: string; name: string; logo: PreviewLogo } | null;
  /** Whoever is the presenting partner now, hidden or not. */
  presenting: { id: string; name: string } | null;
  /** Sponsors per level, not counting this one: where the end of each level is. */
  levelCounts: Record<SponsorLevel, number>;
}

const LEVEL_OPTIONS = sponsorLevel.enumValues.map((l) => [l, SPONSOR_LEVEL_LABELS[l]] as const);
const TONE_OPTIONS = sponsorTileTone.enumValues.map((t) => [t, SPONSOR_TILE_LABELS[t]] as const);

// Fields that show their own error; anything else goes in the banner, so no
// error is ever invisible.
const INLINE = new Set<SponsorFormField | undefined>([
  'name',
  'websiteUrl',
  'level',
  'position',
  'logo',
]);

/**
 * B15 Add sponsor / edit. The chosen logo file lives in state, and submit
 * builds the FormData itself and dispatches inside a transition: a
 * `<form action>` would have React reset the form after every submit,
 * dropping the file and anything typed. `inspectLogo` — the server's own
 * check — runs on the file as soon as it is chosen, for an instant verdict
 * and the preview's shape; the server runs it again as the authority.
 */
export function SponsorForm({ action, initial, sponsor, presenting, levelCounts }: Props) {
  const [state, dispatch, pending] = useActionState(action, {});
  const [level, setLevel] = useState<SponsorLevel>(initial.level);
  const [tone, setTone] = useState<SponsorTileTone>(initial.tileTone);
  const [active, setActive] = useState(initial.active);
  const [position, setPosition] = useState(() => initial.position || endOf(initial.level));
  const [positionTouched, setPositionTouched] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [chosen, setChosen] = useState<PreviewLogo | null>(null);
  const [fileError, setFileError] = useState<string | null>(null);
  // The server's logo error belongs to the file it was sent; choosing
  // another file retires it (by the nonce of that response).
  const [retired, setRetired] = useState<string | undefined>(undefined);
  const picks = useRef(0);

  // A blob: URL holds the file in memory until revoked.
  useEffect(() => {
    const src = chosen?.src;
    return () => {
      if (src) URL.revokeObjectURL(src);
    };
  }, [chosen?.src]);

  /** Where a sponsor lands in `lv` when no order is typed. */
  function endOf(lv: SponsorLevel): string {
    if (sponsor && lv === initial.level) return initial.position;
    // A new presenting partner takes the one place (the old one is demoted).
    return String(lv === 'presenting' ? 1 : levelCounts[lv] + 1);
  }

  function pickLevel(next: SponsorLevel) {
    setLevel(next);
    if (!positionTouched) setPosition(endOf(next));
  }

  async function pickFile(input: HTMLInputElement) {
    const picked = input.files?.[0];
    // Cleared so that choosing the same file again still counts as a change.
    input.value = '';
    if (!picked) return;
    const pick = ++picks.current;
    setRetired(state.nonce);

    let reason: string;
    const check = checkLogoFile(picked, { required: true });
    if (!check.ok) reason = check.error;
    else if (check.file === null) reason = LOGO_FILE_ERRORS.required;
    else {
      const result = inspectLogo(new Uint8Array(await picked.arrayBuffer()), check.contentType);
      if (pick !== picks.current) return; // a later choice already won
      if (result.ok) {
        setFile(picked);
        setChosen({ src: URL.createObjectURL(picked), width: result.width, height: result.height });
        setFileError(null);
        return;
      }
      reason = result.reason;
    }
    // A refused file never lingers as the one that will be sent.
    setFile(null);
    setChosen(null);
    setFileError(reason);
  }

  function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const formData = new FormData(e.currentTarget);
    if (file) formData.set('logo', file);
    startTransition(() => dispatch(formData));
  }

  const err = (field: SponsorFormField) => (state.field === field ? state.error : undefined);
  const logoError =
    fileError ?? (state.field === 'logo' && retired !== state.nonce ? state.error : undefined);
  const bannerError = state.error && !INLINE.has(state.field) ? state.error : null;
  const logo = chosen ?? sponsor?.logo ?? null;
  const demotes = level === 'presenting' && presenting !== null && presenting.id !== sponsor?.id;

  return (
    <div className="grid max-w-300 items-start gap-6 lg:grid-cols-[minmax(0,640px)_minmax(0,1fr)]">
      <form
        onSubmit={onSubmit}
        noValidate
        className="flex flex-col gap-5 rounded-xl border border-border bg-card p-4 shadow-sm sm:p-6"
      >
        {bannerError ? <FormAlert key={state.nonce}>{bannerError}</FormAlert> : null}

        <div className="flex flex-col gap-2">
          <Label htmlFor="sponsor-name">Name</Label>
          <Input
            id="sponsor-name"
            name="name"
            defaultValue={initial.name}
            maxLength={SPONSOR_NAME_MAX}
            autoComplete="off"
            placeholder="Kolorob Audio"
            aria-invalid={Boolean(err('name'))}
            aria-describedby="sponsor-name-note"
            className="h-11 px-3.5 text-base"
          />
          {err('name') ? (
            <InlineError id="sponsor-name-note">{err('name')}</InlineError>
          ) : (
            <Hint id="sponsor-name-note">Used as the logo’s accessible label.</Hint>
          )}
        </div>

        <div className="flex flex-col gap-2">
          <Label htmlFor="sponsor-website">Website</Label>
          <Input
            id="sponsor-website"
            name="websiteUrl"
            type="url"
            inputMode="url"
            defaultValue={initial.websiteUrl}
            autoComplete="off"
            spellCheck={false}
            placeholder="https://"
            aria-invalid={Boolean(err('websiteUrl'))}
            aria-describedby="sponsor-website-note"
            className="h-11 px-3.5 font-mono text-[15px]"
          />
          {err('websiteUrl') ? (
            <InlineError id="sponsor-website-note">{err('websiteUrl')}</InlineError>
          ) : (
            <Hint id="sponsor-website-note">Opens in a new tab when someone clicks the logo.</Hint>
          )}
        </div>

        <fieldset className="flex flex-col">
          <legend className="mb-2 text-sm font-medium">Level</legend>
          <SegmentedControl
            name="level"
            value={level}
            options={LEVEL_OPTIONS}
            onChange={pickLevel}
            describedBy={err('level') ? 'sponsor-level-error' : undefined}
            invalid={Boolean(err('level'))}
          />
          {/* Always in the page, so the warning is read out when it appears. */}
          <div aria-live="polite" className="not-empty:mt-2">
            {demotes ? (
              <p
                className="rounded-lg border border-accent-border bg-accent px-3.5 py-2.5 text-sm leading-normal text-[#5c4514]"
                data-testid="presenting-warning"
              >
                {presenting.name} is the presenting partner now. Saving makes it a Partner.
              </p>
            ) : null}
          </div>
          {err('level') ? (
            <div className="mt-2">
              <InlineError id="sponsor-level-error">{err('level')}</InlineError>
            </div>
          ) : null}
        </fieldset>

        <div className="flex flex-col gap-2">
          <span id="sponsor-logo-label" className="text-sm font-medium">
            Logo
          </span>
          <label
            className={cn(
              'relative flex cursor-pointer items-center gap-4 rounded-xl border-[1.5px] border-dashed bg-background p-4 transition-colors hover:border-foreground has-focus-visible:ring-2 has-focus-visible:ring-foreground has-focus-visible:ring-offset-2',
              logoError ? 'border-destructive' : 'border-border-strong',
            )}
          >
            <input
              type="file"
              accept={SPONSOR_LOGO_ACCEPT}
              data-testid="logo-file"
              aria-labelledby="sponsor-logo-label sponsor-logo-action"
              aria-describedby={
                logoError ? 'sponsor-logo-error sponsor-logo-hint' : 'sponsor-logo-hint'
              }
              aria-invalid={Boolean(logoError)}
              onChange={(e) => void pickFile(e.currentTarget)}
              className="sr-only"
            />
            <span className="flex h-14 w-22 shrink-0 items-center justify-center rounded-lg border border-border bg-card">
              {logo ? (
                // Plain <img>: a blob: preview or a stored logo (ADR-033).
                // eslint-disable-next-line @next/next/no-img-element
                <img src={logo.src} alt="" className="block max-h-10 max-w-18" />
              ) : null}
            </span>
            <span className="flex flex-col gap-0.5">
              <span id="sponsor-logo-action" className="text-[15px] font-semibold">
                {logo ? 'Replace logo' : 'Upload logo'}
              </span>
              <span id="sponsor-logo-hint" className="text-[13px] text-muted-foreground">
                SVG or PNG, any shape. Transparent background works best. It is never stretched.
              </span>
            </span>
          </label>
          {logoError ? <InlineError id="sponsor-logo-error">{logoError}</InlineError> : null}
        </div>

        <fieldset className="flex flex-col gap-2">
          <legend className="mb-2 text-sm font-medium">Tile behind the logo</legend>
          <SegmentedControl
            name="tileTone"
            value={tone}
            options={TONE_OPTIONS}
            onChange={setTone}
          />
          <FieldHint>
            Pick Dark for white or light-coloured logos. Check both previews{' '}
            <span className="lg:hidden">below</span>
            <span className="hidden lg:inline">on the right</span>.
          </FieldHint>
        </fieldset>

        <div className="flex flex-col gap-2">
          <div className="flex flex-wrap items-end gap-6">
            <div className="flex flex-col gap-2">
              <Label htmlFor="sponsor-position">Display order</Label>
              <Input
                id="sponsor-position"
                name="position"
                type="number"
                inputMode="numeric"
                min={1}
                value={position}
                onChange={(e) => {
                  setPosition(e.target.value);
                  setPositionTouched(true);
                }}
                aria-invalid={Boolean(err('position'))}
                aria-describedby={err('position') ? 'sponsor-position-error' : undefined}
                className="h-11 w-24 px-3.5 font-mono text-[15px] font-medium tabular"
              />
            </div>
            <div className="flex h-11 items-center gap-2.5">
              <Switch
                checked={active}
                onCheckedChange={(next: boolean) => setActive(next)}
                // A fixed name: the visible text flips with the state, and
                // "Hidden…, off" would read as "not hidden". The switch's
                // on/off is announced already.
                aria-label="Show on the site"
              />
              {active ? <input type="hidden" name="active" value="on" /> : null}
              <span aria-hidden="true" className="text-[15px]">
                {active ? 'Active — shown on the site' : 'Hidden — kept but not shown'}
              </span>
            </div>
          </div>
          {err('position') ? (
            <InlineError id="sponsor-position-error">{err('position')}</InlineError>
          ) : null}
        </div>

        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border pt-5">
          {sponsor ? (
            <DeleteSponsorButton id={sponsor.id} name={sponsor.name} from="form" />
          ) : (
            <span />
          )}
          <div className="flex gap-2">
            <ButtonLink href="/admin/sponsors" variant="secondary">
              Cancel
            </ButtonLink>
            <Button type="submit" disabled={pending}>
              {pending ? 'Saving…' : sponsor ? 'Save changes' : 'Add sponsor'}
            </Button>
          </div>
        </div>
      </form>

      <SponsorPreview logo={logo} level={level} tone={tone} />
    </div>
  );
}

function Hint({ id, children }: { id: string; children: ReactNode }) {
  return (
    <p id={id} className="text-sm leading-snug text-muted-foreground">
      {children}
    </p>
  );
}

function InlineError({ id, children }: { id?: string; children: ReactNode }) {
  return (
    <p id={id} className="text-sm leading-snug font-medium text-destructive" role="alert">
      {children}
    </p>
  );
}
