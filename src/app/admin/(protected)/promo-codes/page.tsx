import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { Plus } from 'lucide-react';
import { z } from 'zod';
import { promoCodesService } from '@/server/container';
import { PromoCodeNotFoundError } from '@/server/lib/errors';
import { formatBDT, formatDecimalBDT } from '@/server/lib/money';
import { describePromo } from '@/server/lib/promo';
import type { PromoCodeListRow, PromoCodeRule } from '@/server/repositories/promo-codes.repository';
import { ButtonLink } from '@/components/button-link';
import { EmptyState } from '@/components/empty-state';
import { FormSuccess } from '@/components/form-field';
import { Money } from '@/components/money';
import { PageHeader } from '@/components/page-header';
import { Chip } from '@/components/status-chip';
import { cn } from '@/lib/utils';
import { deletePromoCodeAction, savePromoCodeAction, type PromoCodeFormValues } from './actions';
import { ActiveSwitch } from './active-switch';
import { PromoCodeSheet } from './promo-code-sheet';

export const metadata: Metadata = { title: 'Promo codes' };
export const dynamic = 'force-dynamic';

interface Props {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

const BLANK: PromoCodeFormValues = {
  code: '',
  type: 'percentage',
  value: '',
  // Not pre-chosen: the organizer decides between every ticket type and a
  // few — the widest scope is never a default.
  scope: '',
  ticketTypeIds: [],
  active: true,
};

// B10: the codes table, and the create/edit sheet driven by `?new=1` /
// `?edit=<id>`. Thin: the service lists, the actions write.
export default async function PromoCodesPage({ searchParams }: Props) {
  const raw = await searchParams;
  const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);
  const editId = first(raw.edit);
  const creating = first(raw.new) === '1';
  const saved = first(raw.saved);
  const created = first(raw.created) === '1';

  const rows = await promoCodesService.list();
  const editing = editId ? rows.find((r) => r.promo.id === editId) : undefined;
  if (editId && (!z.uuid().safeParse(editId).success || !editing)) notFound();
  const groups =
    creating || editing
      ? await promoCodesService.pickerOptions(
          editing?.restrictions.map((r) => r.ticketTypeId) ?? [],
        )
      : [];

  // Read the rule before building any JSX: a missing code is a 404, not a render error.
  let rule: PromoCodeRule | null = null;
  if (editing) {
    try {
      rule = await promoCodesService.get(editing.promo.id);
    } catch (err: unknown) {
      if (err instanceof PromoCodeNotFoundError) notFound();
      throw err;
    }
  }

  const sheet = rule ? (
    <PromoCodeSheet
      mode="edit"
      action={savePromoCodeAction.bind(null, rule.id)}
      deleteAction={editing?.everUsed ? undefined : deletePromoCodeAction.bind(null, rule.id)}
      initial={{
        code: rule.code,
        type: rule.type,
        // Fixed values are paisa; the form edits taka ("200", "199.50").
        value:
          rule.type === 'percentage'
            ? String(rule.value)
            : formatDecimalBDT(rule.value).replace(/\.00$/, ''),
        scope: rule.ticketTypeIds.length === 0 ? 'all' : 'some',
        ticketTypeIds: rule.ticketTypeIds,
        active: rule.active,
      }}
      groups={groups}
    />
  ) : creating ? (
    <PromoCodeSheet
      mode="new"
      action={savePromoCodeAction.bind(null, null)}
      initial={BLANK}
      groups={groups}
    />
  ) : null;

  const newButton = (
    <ButtonLink href="/admin/promo-codes?new=1" scroll={false} size="sm">
      <Plus className="size-4" aria-hidden="true" />
      New code
    </ButtonLink>
  );

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Promo codes"
        subtitle={
          rows.length === 0
            ? 'No codes yet'
            : `${rows.length} ${rows.length === 1 ? 'code' : 'codes'} · unlimited uses each`
        }
        actions={rows.length > 0 ? newButton : undefined}
      />

      {saved ? (
        <FormSuccess>
          {created ? `${saved} created.` : `${saved} saved.`} Changes apply to new orders; orders
          already placed keep their price.
        </FormSuccess>
      ) : null}

      {rows.length === 0 ? (
        <EmptyState
          icon="%"
          title="No promo codes yet"
          description="Codes work across every event unless you restrict them to particular ticket types."
          action={newButton}
        />
      ) : (
        <>
          <div className="hidden overflow-hidden rounded-xl border border-border bg-card shadow-sm lg:block">
            <table className="w-full text-[14px]">
              <thead>
                <tr className="border-b border-border bg-secondary/60 text-left text-[12px] text-muted-foreground">
                  <th className="px-4 py-2.5 font-medium">Code</th>
                  <th className="px-4 py-2.5 font-medium">Discount</th>
                  <th className="px-4 py-2.5 font-medium">Restricted to</th>
                  <th className="px-4 py-2.5 text-right font-medium">Uses</th>
                  <th className="px-4 py-2.5 text-right font-medium">Discount given</th>
                  <th className="px-4 py-2.5 font-medium">Active</th>
                  <th className="px-4 py-2.5">
                    <span className="sr-only">Edit</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr
                    key={r.promo.id}
                    className={cn(
                      'border-b border-border last:border-0',
                      !r.promo.active && 'text-muted-foreground',
                    )}
                    data-testid="promo-row"
                  >
                    <td className="px-4 py-3 font-mono font-semibold tracking-wide">
                      {r.promo.code}
                    </td>
                    <td className="px-4 py-3 tabular">{describeDiscount(r)}</td>
                    <td className="px-4 py-3">
                      <Restrictions row={r} />
                    </td>
                    <td className="px-4 py-3 text-right tabular">
                      <Uses row={r} />
                    </td>
                    <td className="px-4 py-3 text-right tabular">
                      <Money paisa={r.discountGivenPaisa} />
                    </td>
                    <td className="px-4 py-3">
                      <ActiveSwitch id={r.promo.id} code={r.promo.code} active={r.promo.active} />
                    </td>
                    <td className="px-4 py-3 text-right">
                      <Link
                        href={`/admin/promo-codes?edit=${r.promo.id}`}
                        scroll={false}
                        className="text-[13px] font-semibold underline underline-offset-2"
                      >
                        Edit
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Phone layout */}
          <ul className="flex flex-col gap-3 lg:hidden">
            {rows.map((r) => (
              <li
                key={r.promo.id}
                className="flex flex-col gap-2.5 rounded-xl border border-border bg-card p-4 shadow-sm"
              >
                <div className="flex items-center justify-between gap-3">
                  <span className="font-mono text-[17px] font-semibold tracking-wide">
                    {r.promo.code}
                  </span>
                  <ActiveSwitch id={r.promo.id} code={r.promo.code} active={r.promo.active} />
                </div>
                <p className="text-[15px] font-medium">{describeDiscount(r)}</p>
                <Restrictions row={r} />
                <div className="flex items-center justify-between gap-3 text-[13px] text-muted-foreground tabular">
                  <span>
                    <Uses row={r} /> · <Money paisa={r.discountGivenPaisa} /> given
                  </span>
                  <Link
                    href={`/admin/promo-codes?edit=${r.promo.id}`}
                    scroll={false}
                    className="font-semibold text-foreground underline underline-offset-2"
                  >
                    Edit
                  </Link>
                </div>
              </li>
            ))}
          </ul>

          <p className="text-[13px] text-muted-foreground">
            Uses count verified orders. Turning a code off stops new uses; orders already discounted
            keep their price.
          </p>
        </>
      )}

      {sheet}
    </div>
  );
}

/** "20%" / "৳200.00" — the design's Discount column; each ticket, see describePromo. */
function describeDiscount(r: PromoCodeListRow): string {
  return r.promo.type === 'percentage' ? `${r.promo.value}%` : formatBDT(r.promo.value);
}

function Restrictions({ row }: { row: PromoCodeListRow }) {
  if (row.restrictions.length === 0) {
    return <span className="text-muted-foreground">Any ticket type</span>;
  }
  return (
    <span className="flex flex-wrap gap-1.5" title={describePromo(row.promo)}>
      {row.restrictions.map((t) => (
        <Chip key={t.ticketTypeId} tone="neutral" size="sm">
          {t.ticketTypeName}
          <span className="font-normal opacity-70"> · {t.eventTitle}</span>
        </Chip>
      ))}
    </span>
  );
}

function Uses({ row }: { row: PromoCodeListRow }) {
  return (
    <span data-testid="promo-uses">
      {row.verifiedUses}
      {row.pendingUses > 0 ? (
        <span className="text-muted-foreground"> · +{row.pendingUses} pending</span>
      ) : null}
    </span>
  );
}
