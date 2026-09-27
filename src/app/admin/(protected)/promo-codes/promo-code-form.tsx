'use client';

import { useActionState, useState, useTransition } from 'react';
import { formatBDT, takaToPaisa } from '@/server/lib/money';
import { promoDiscountPerTicket, type PromoType } from '@/server/lib/promo';
import type { PromoPickerGroup } from '@/server/services/promo-codes.service';
import { Button } from '@/components/button';
import { Field, FieldHint, FormAlert } from '@/components/form-field';
import { SegmentedControl } from '@/components/segmented-control';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { cn } from '@/lib/utils';
import type { PromoCodeFormState, PromoCodeFormValues, RowActionResult } from './actions';

interface Props {
  action: (prev: PromoCodeFormState, formData: FormData) => Promise<PromoCodeFormState>;
  /** Present when editing a code no order has used. */
  deleteAction?: () => Promise<RowActionResult>;
  initial: PromoCodeFormValues;
  /** Editing: the code text is fixed and shown, not typed. */
  editing: boolean;
  groups: PromoPickerGroup[];
  onDone: () => void;
}

const TAKA = /^\d{1,7}(?:\.\d{1,2})?$/;

const TYPE_OPTIONS = [
  ['percentage', 'Percentage'],
  ['fixed', 'Fixed ৳'],
] as const;

/**
 * B10 "New promo code" sheet body. Uncontrolled where it can be; the few
 * controlled bits (type, value, ticked types) drive the live preview
 * "A General ticket becomes ৳1,020.00", computed with the same pure rule
 * the server prices orders with. The server re-validates everything.
 */
export function PromoCodeForm({ action, ...rest }: Props) {
  const [state, formAction, pending] = useActionState(action, {});
  return (
    <form action={formAction} className="flex min-h-0 flex-1 flex-col" noValidate>
      {/* React 19 resets the form's DOM after every action; remounting the
          fields per result keeps radios and checkboxes in step with state. */}
      <PromoCodeFields key={state.nonce ?? 'initial'} state={state} pending={pending} {...rest} />
    </form>
  );
}

function PromoCodeFields({
  state,
  pending,
  deleteAction,
  initial,
  editing,
  groups,
  onDone,
}: Omit<Props, 'action'> & { state: PromoCodeFormState; pending: boolean }) {
  // After a failed submit, re-seed from what was submitted — nothing typed is lost.
  const seed = state.values ?? initial;
  const [type, setType] = useState<PromoType>(seed.type === 'fixed' ? 'fixed' : 'percentage');
  const [value, setValue] = useState(seed.value);
  const [scope, setScope] = useState<'all' | 'some' | ''>(seed.scope);
  const [ticked, setTicked] = useState<string[]>(seed.ticketTypeIds);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [deleting, startDelete] = useTransition();

  const allTypes = groups.flatMap((g) => g.ticketTypes);
  const previewType =
    (scope === 'some' ? allTypes.find((t) => ticked.includes(t.id)) : undefined) ??
    allTypes[0] ??
    null;
  const parsedValue =
    type === 'percentage'
      ? /^\d{1,2}$/.test(value) && Number(value) >= 1 && Number(value) <= 99
        ? Number(value)
        : null
      : TAKA.test(value) && Number(value) > 0
        ? takaToPaisa(Number(value))
        : null;
  const previewOff =
    previewType && parsedValue !== null
      ? promoDiscountPerTicket({ type, value: parsedValue }, previewType.pricePaisa)
      : null;
  // A code never makes a ticket free (bKash cannot take ৳0): say so up front.
  const preview =
    previewType && previewOff !== null
      ? previewOff >= previewType.pricePaisa
        ? `It would make a ${previewType.name} ticket free, so it won't apply to ${previewType.name}.`
        : `A ${previewType.name} ticket becomes ${formatBDT(previewType.pricePaisa - previewOff)}.`
      : null;

  const err = (field: PromoCodeFormState['field']) => (state.field === field ? state.error : null);
  // A value error belongs to the value that was submitted: once it is edited
  // the error gives way to the hint and the live preview again.
  const valueError = err('value') && value === state.values?.value ? err('value') : null;

  // Any error without a visible field of its own goes in the banner — an
  // error the organizer cannot see is a Save button that silently does nothing.
  // Fields that render their own error below; anything else goes in the
  // banner, so no error can ever be invisible (the code field is not
  // rendered when editing).
  const inline = new Set<PromoCodeFormState['field']>(
    editing ? ['value', 'scope', 'ticketTypeIds'] : ['code', 'value', 'scope', 'ticketTypeIds'],
  );
  const bannerError = state.error && !inline.has(state.field) ? state.error : null;

  return (
    <>
      <div className="flex flex-1 flex-col gap-6 overflow-y-auto px-6 pb-6">
        {bannerError ? <FormAlert>{bannerError}</FormAlert> : null}

        {editing ? (
          <div className="flex flex-col gap-1">
            {/* The code cannot change, but the form still names it. */}
            <input type="hidden" name="code" value={initial.code} />
            <span className="text-sm font-medium">Code</span>
            <span className="font-mono text-lg font-semibold tracking-wide" data-testid="edit-code">
              {initial.code}
            </span>
            <FieldHint>A code cannot be renamed — buyers may already have it.</FieldHint>
          </div>
        ) : (
          <Field
            label="Code"
            htmlFor="promo-code"
            hint={
              err('code') ? undefined : 'Always stored in capitals; buyers can type it either way.'
            }
          >
            <Input
              id="promo-code"
              name="code"
              defaultValue={seed.code}
              autoComplete="off"
              autoCapitalize="characters"
              spellCheck={false}
              maxLength={24}
              aria-invalid={Boolean(err('code'))}
              onInput={(e) => {
                e.currentTarget.value = e.currentTarget.value.toUpperCase();
              }}
              className="h-11 font-mono tracking-wide uppercase"
              placeholder="DHAKA15"
            />
            {err('code') ? <InlineError>{err('code')}</InlineError> : null}
          </Field>
        )}

        <fieldset className="flex flex-col gap-2">
          <legend className="mb-2 text-sm font-medium">Type</legend>
          <SegmentedControl name="type" value={type} options={TYPE_OPTIONS} onChange={setType} />
        </fieldset>

        <div className="flex flex-col gap-2">
          <Label htmlFor="promo-value">Value</Label>
          <div className="flex w-44 items-stretch">
            {type === 'fixed' ? (
              <span className="flex items-center rounded-l-md border border-r-0 border-input bg-secondary px-3 text-muted-foreground">
                ৳
              </span>
            ) : null}
            <Input
              id="promo-value"
              name="value"
              inputMode="decimal"
              value={value}
              onChange={(e) => setValue(e.target.value.trim())}
              aria-invalid={Boolean(valueError)}
              className={cn('h-11 tabular', type === 'fixed' ? 'rounded-l-none' : 'rounded-r-none')}
              placeholder={type === 'fixed' ? '200' : '15'}
            />
            {type === 'percentage' ? (
              <span className="flex items-center rounded-r-md border border-l-0 border-input bg-secondary px-3 text-muted-foreground">
                %
              </span>
            ) : null}
          </div>
          {valueError ? (
            <InlineError>{valueError}</InlineError>
          ) : (
            <FieldHint>
              {type === 'percentage'
                ? '1 – 99, off each ticket.'
                : 'Off each ticket. It won’t apply to a ticket it would make free.'}{' '}
              {preview ? (
                <span className="font-medium text-foreground" data-testid="promo-preview">
                  {preview}
                </span>
              ) : null}
            </FieldHint>
          )}
        </div>

        <fieldset className="flex flex-col gap-3">
          <legend className="mb-1 text-sm font-medium">Works on</legend>
          <div className="flex flex-col gap-1.5">
            {(
              [
                ['all', 'Any ticket type, in any event'],
                ['some', 'Only these ticket types'],
              ] as const
            ).map(([v, label]) => (
              <label key={v} className="flex cursor-pointer items-center gap-2.5 text-[15px]">
                <input
                  type="radio"
                  name="scope"
                  value={v}
                  checked={scope === v}
                  onChange={() => setScope(v)}
                  className="size-4 shrink-0 accent-foreground"
                />
                {label}
              </label>
            ))}
          </div>
          {scope === 'some' ? (
            <div className="flex flex-col gap-3 rounded-lg border border-border p-3">
              {groups.length === 0 ? (
                <FieldHint>No upcoming events with ticket types yet.</FieldHint>
              ) : (
                groups.map((g) => (
                  <div key={g.event.id} className="flex flex-col gap-1.5">
                    <span className="text-[13px] font-semibold text-muted-foreground">
                      {g.event.title}
                    </span>
                    {g.ticketTypes.map((t) => (
                      <label
                        key={t.id}
                        className="flex cursor-pointer items-center gap-2.5 rounded-md px-1 py-1 text-[15px] hover:bg-secondary"
                      >
                        <input
                          type="checkbox"
                          name="ticketTypeIds"
                          value={t.id}
                          checked={ticked.includes(t.id)}
                          onChange={(e) =>
                            setTicked((xs) =>
                              e.target.checked ? [...xs, t.id] : xs.filter((x) => x !== t.id),
                            )
                          }
                          className="size-4 shrink-0 accent-foreground"
                        />
                        <span>
                          {t.name} — {formatBDT(t.pricePaisa)}
                          {t.saleEnded ? (
                            <span className="text-muted-foreground"> · sales window ended</span>
                          ) : null}
                        </span>
                      </label>
                    ))}
                  </div>
                ))
              )}
            </div>
          ) : null}
          {err('scope') ? (
            <InlineError>{err('scope')}</InlineError>
          ) : err('ticketTypeIds') ? (
            <InlineError>{err('ticketTypeIds')}</InlineError>
          ) : scope === 'all' ? (
            <FieldHint>Every ticket type, including events you add later.</FieldHint>
          ) : null}
        </fieldset>

        <label className="flex items-center gap-2.5 text-[15px]">
          <input
            type="checkbox"
            name="active"
            defaultChecked={seed.active}
            className="size-4 shrink-0 accent-foreground"
          />
          {editing ? 'Active' : 'Active straight away'}
        </label>

        {deleteAction ? (
          <div className="flex flex-col gap-2 rounded-xl border border-border px-4 py-3">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <span className="text-sm text-muted-foreground">
                No order has used this code, so it can be deleted.
              </span>
              <Button
                type="button"
                variant="destructive"
                size="sm"
                disabled={deleting}
                onClick={() => {
                  if (!window.confirm(`Delete ${initial.code}? This cannot be undone.`)) return;
                  startDelete(async () => {
                    const r = await deleteAction();
                    if (r.ok) onDone();
                    else setDeleteError(r.error);
                  });
                }}
              >
                {deleting ? 'Deleting…' : 'Delete code'}
              </Button>
            </div>
            {deleteError ? <InlineError>{deleteError}</InlineError> : null}
          </div>
        ) : null}
      </div>

      <div className="flex justify-end gap-2 border-t border-border bg-card px-6 py-4">
        <Button type="button" variant="secondary" onClick={onDone}>
          Cancel
        </Button>
        <Button type="submit" disabled={pending}>
          {pending ? 'Saving…' : editing ? 'Save changes' : 'Create code'}
        </Button>
      </div>
    </>
  );
}

function InlineError({ children }: { children: React.ReactNode }) {
  return (
    <p className="text-sm leading-snug font-medium text-destructive" role="alert">
      {children}
    </p>
  );
}
