import type { Metadata } from 'next';
import { Plus } from 'lucide-react';
import { sponsorsService } from '@/server/container';
import type { SponsorLevel } from '@/server/repositories/sponsors.repository';
import type { AdminSponsor } from '@/server/services/sponsors.service';
import { ButtonLink } from '@/components/button-link';
import { EmptyState } from '@/components/empty-state';
import { PageHeader } from '@/components/page-header';
import { SPONSOR_LOGO_BOXES, fitLogo } from '@/lib/sponsor-fit';
import { SPONSOR_GROUP_LABELS } from '@/lib/sponsor-levels';
import { cn } from '@/lib/utils';
import { DeleteSponsorButton } from './delete-sponsor';
import { ListStatus } from './list-status';
import { OrderControls, SponsorActiveSwitch } from './row-controls';

export const metadata: Metadata = { title: 'Sponsors' };
export const dynamic = 'force-dynamic';

interface Props {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

const HINTS: Record<SponsorLevel, string> = {
  presenting: 'Shown large, above the logo wall',
  partner: 'Logo wall, larger tiles',
  supporter: 'Logo wall, smaller tiles',
};

// B15: every sponsor, grouped by level in display order, hidden ones too.
// Thin: the service lists, the row controls and the form's actions write.
export default async function SponsorsPage({ searchParams }: Props) {
  const raw = await searchParams;
  const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);
  const saved = first(raw.saved);
  const deleted = first(raw.deleted);
  const banner = saved ? `${saved} saved.` : deleted ? `${deleted} deleted.` : null;

  const groups = (await sponsorsService.listForAdmin()).filter((g) => g.sponsors.length > 0);

  const addButton = (
    <ButtonLink href="/admin/sponsors/new">
      <Plus className="size-4" aria-hidden="true" />
      Add sponsor
    </ButtonLink>
  );

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Sponsors"
        subtitle={
          groups.length > 0 ? (
            <span className="block max-w-160 leading-relaxed">
              Active sponsors appear in “Supported by” on the home page and in the footer, grouped
              by level, in the order below. There is one presenting partner at a time.
            </span>
          ) : undefined
        }
        actions={groups.length > 0 ? addButton : undefined}
      />

      <ListStatus initial={banner}>
        {groups.length === 0 ? (
          <EmptyState
            title="No sponsors yet"
            description="Sponsors you add here appear in a “Supported by” section on the home page and in the footer. The section stays hidden until at least one sponsor is active."
            action={addButton}
          />
        ) : (
          groups.map((g) => (
            <section
              key={g.level}
              aria-labelledby={`sponsors-${g.level}`}
              data-testid={`sponsor-group-${g.level}`}
              className="flex flex-col gap-3 lg:gap-0 lg:overflow-hidden lg:rounded-xl lg:border lg:border-border lg:bg-card lg:shadow-sm"
            >
              <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 lg:border-b lg:border-border lg:bg-background lg:px-5 lg:py-3.5">
                <h2 id={`sponsors-${g.level}`} className="font-heading text-base font-semibold">
                  {SPONSOR_GROUP_LABELS[g.level]}{' '}
                  <span className="font-sans text-sm font-normal text-muted-foreground">
                    · {g.sponsors.length}
                  </span>
                </h2>
                <p className="text-[13px] text-muted-foreground">{HINTS[g.level]}</p>
              </div>
              <ul className="flex flex-col gap-3 lg:gap-0">
                {g.sponsors.map((s) => (
                  <SponsorRow key={s.id} sponsor={s} count={g.sponsors.length} />
                ))}
              </ul>
            </section>
          ))
        )}
      </ListStatus>
    </div>
  );
}

/**
 * One sponsor. A row of the group's table from `lg`; a stacked card below
 * it (logo and name, then order and Active, then the buttons). One DOM for
 * both, so tab order follows what the eye sees at either width.
 */
function SponsorRow({ sponsor: s, count }: { sponsor: AdminSponsor; count: number }) {
  return (
    <li
      data-testid="sponsor-row"
      className={cn(
        'grid grid-cols-[auto_minmax(0,1fr)] items-center gap-x-4 gap-y-3 rounded-xl border border-border bg-card p-4 shadow-sm [grid-template-areas:"thumbs_name"_"order_active"_"actions_actions"]',
        'lg:grid-cols-[104px_132px_minmax(0,1fr)_150px_170px] lg:gap-4 lg:rounded-none lg:border-0 lg:border-t lg:px-5 lg:py-3 lg:shadow-none lg:[grid-template-areas:"order_thumbs_name_active_actions"] lg:first:border-t-0',
      )}
    >
      <div className="[grid-area:order]">
        <OrderControls id={s.id} name={s.name} position={s.position} count={count} />
      </div>
      <div className={cn('flex gap-1 [grid-area:thumbs]', !s.active && 'opacity-60')}>
        <Thumb sponsor={s} tone="light" />
        {s.tileTone === 'dark' ? <Thumb sponsor={s} tone="dark" /> : null}
      </div>
      <div className="flex min-w-0 flex-col [grid-area:name]">
        <span
          className={cn('text-[15px] font-semibold', !s.active && 'opacity-60')}
          data-testid="sponsor-name"
        >
          {s.name}
        </span>
        <span className="truncate font-mono text-[13px] text-muted-foreground">
          {s.websiteUrl ?? 'No website'}
        </span>
      </div>
      <div className="justify-self-end [grid-area:active] lg:justify-self-start">
        <SponsorActiveSwitch id={s.id} name={s.name} active={s.active} />
      </div>
      <div className="flex justify-end gap-2 [grid-area:actions]">
        <ButtonLink
          href={`/admin/sponsors/${s.id}/edit`}
          variant="secondary"
          size="sm"
          className="h-11 lg:h-9"
        >
          Edit<span className="sr-only"> {s.name}</span>
        </ButtonLink>
        <DeleteSponsorButton id={s.id} name={s.name} from="row" />
      </div>
    </li>
  );
}

/** B15 thumbnail: the logo on its tile, sized by the same rule as the site. */
function Thumb({ sponsor: s, tone }: { sponsor: AdminSponsor; tone: 'light' | 'dark' }) {
  const box = SPONSOR_LOGO_BOXES.adminThumb;
  const size = fitLogo(s.logoWidth / s.logoHeight, box);
  return (
    <span
      className={cn(
        'flex shrink-0 items-center justify-center rounded-sm border',
        tone === 'dark' ? 'border-foreground bg-foreground' : 'border-border bg-card',
      )}
      style={{ width: box.w, height: box.h }}
    >
      {/* Decorative: the name sits beside it. Plain <img> — the storage
          host is env-defined, so next/image's allow-list would have to follow it. */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={s.logoUrl} alt="" className="block" style={{ width: size.w, height: size.h }} />
    </span>
  );
}
