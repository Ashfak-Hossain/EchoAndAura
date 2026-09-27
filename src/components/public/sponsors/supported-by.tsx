import Link from 'next/link';
import type { PublicSponsor } from '@/server/services/sponsors.service';
import { SPONSOR_GROUP_LABELS } from '@/lib/sponsor-levels';
import { SPONSOR_LOGO_BOXES } from '@/lib/sponsor-fit';
import { cn } from '@/lib/utils';
import { SPONSOR_LINK_REL, SponsorLogo, SponsorTile, tileHeightVars } from './sponsor-tile';

/** The grid for each level's tiles: fewer, larger partner tiles; more, smaller supporter ones. */
const GROUPS = [
  { level: 'partner', grid: 'grid-cols-2 lg:grid-cols-4' },
  { level: 'supporter', grid: 'grid-cols-3 lg:grid-cols-6' },
] as const;

/**
 * S1 "Supported by" (Canvas 6): the presenting partner as a wide card, then
 * Partners and Supporters as tile grids, each in display order. Props only —
 * the page passes the active sponsors. With none, nothing renders: the
 * section never hints at an empty slot. Full-colour logos (N10 "colour").
 */
export function SupportedBy({ sponsors }: { sponsors: PublicSponsor[] }) {
  if (sponsors.length === 0) return null;
  // The schema allows one presenting partner (a partial unique index).
  const presenting = sponsors.find((s) => s.level === 'presenting');

  return (
    <section aria-labelledby="supported-by-heading" className="px-4 pt-16 lg:px-16 lg:pt-24">
      <div className="mx-auto flex max-w-328 flex-col gap-6 border-t border-border">
        <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-2">
          <h2
            id="supported-by-heading"
            className="text-[24px] leading-[1.15] font-bold tracking-[-0.02em] lg:text-[36px]"
          >
            Supported by
          </h2>
          <Link
            href="/contact"
            className="inline-flex min-h-11 items-center text-sm text-muted-foreground underline underline-offset-2 hover:text-foreground"
          >
            Want to sponsor a night? Get in touch →
          </Link>
        </div>

        {presenting ? <PresentingCard sponsor={presenting} /> : null}

        {GROUPS.map(({ level, grid }) => {
          const items = sponsors.filter((s) => s.level === level);
          if (items.length === 0) return null;
          return (
            <div key={level} className="flex flex-col gap-3">
              {/* font-sans: the base layer sets every h3 in Archivo; this is an overline. */}
              <h3 className="font-sans text-xs font-medium tracking-[0.14em] text-muted-foreground uppercase">
                {SPONSOR_GROUP_LABELS[level]}
              </h3>
              <ul className={cn('grid gap-3', grid)}>
                {items.map((s) => (
                  <li key={s.id} className="min-w-0">
                    <SponsorTile sponsor={s} />
                  </li>
                ))}
              </ul>
            </div>
          );
        })}
      </div>
    </section>
  );
}

/** "https://www.kolorob.com/about" → "kolorob.com": the card names the site, not the page. */
function siteDomain(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return url;
  }
}

/**
 * The presenting partner: text beside the logo from `lg`, logo on top on
 * phones. Unlike a tile it shows the name as text, so the link is named by
 * its content ("Presenting partner", name, site) rather than an aria-label
 * — a screen reader hears the level too — and the logo's alt stays empty.
 */
function PresentingCard({ sponsor }: { sponsor: PublicSponsor }) {
  const boxes = SPONSOR_LOGO_BOXES.presenting;
  const url = sponsor.websiteUrl;
  const frame =
    'grid grid-cols-1 items-center overflow-hidden rounded-lg border border-border bg-card text-foreground lg:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)]';

  const body = (
    <>
      <div className="order-1 flex flex-col gap-2 p-6 lg:order-0">
        <span className="text-xs font-medium tracking-[0.14em] text-muted-foreground uppercase">
          Presenting partner
        </span>
        <span className="font-heading text-[24px] leading-[1.2] font-semibold">{sponsor.name}</span>
        {url ? (
          <span className="font-mono text-sm wrap-anywhere text-muted-foreground">
            {siteDomain(url)}
            <span aria-hidden="true">&nbsp;↗</span>
            <span className="sr-only"> (opens in a new tab)</span>
          </span>
        ) : null}
      </div>
      {/* The divider stays the card's border colour on either tone. */}
      <div
        className={cn(
          'flex h-(--th) items-center justify-center border-b border-border lg:h-(--lth) lg:border-b-0 lg:border-l',
          sponsor.tileTone === 'dark' ? 'bg-foreground' : 'bg-card',
        )}
        style={tileHeightVars(boxes)}
      >
        <SponsorLogo sponsor={sponsor} mobile={boxes.mobile} desktop={boxes.desktop} alt="" />
      </div>
    </>
  );

  if (!url) return <div className={frame}>{body}</div>;
  return (
    <a
      href={url}
      target="_blank"
      rel={SPONSOR_LINK_REL}
      className={cn(
        frame,
        'transition-[border-color,box-shadow] hover:border-border-strong hover:shadow-md',
      )}
    >
      {body}
    </a>
  );
}
