import type { CSSProperties, ReactNode } from 'react';
import type { PublicSponsor } from '@/server/services/sponsors.service';
import { type GridTileBox, type LogoBox, SPONSOR_LOGO_BOXES, fitLogo } from '@/lib/sponsor-fit';
import { cn } from '@/lib/utils';

/**
 * Sponsor marks (Canvas 6, N10). Everything here renders on the server with
 * no client JS: the fitted sizes are computed per request and handed to CSS.
 */

/** React's style type has no custom properties; the tiles set a few of their own. */
type StyleWithVars = CSSProperties & Record<`--${string}`, string>;

/**
 * `sponsored` marks the link as paid placement for search engines (plan
 * decision 8); `noopener` keeps the sponsor's tab from reaching back into
 * this one.
 */
export const SPONSOR_LINK_REL = 'sponsored noopener';

/** The name a sponsor link announces: the mark shows no text, so the label is the name. */
export function sponsorLinkLabel(name: string): string {
  return `${name} (opens in a new tab)`;
}

/**
 * One logo at its N10 fitted size. Both sizes — phone, and desktop from
 * `lg` — are worked out here and passed to CSS as custom properties, so
 * each breakpoint gets its exact size without measuring anything in the
 * browser. `max-w-full` + `object-contain` keep a logo whole if its tile
 * ever comes out narrower than the box: it shrinks, never stretches.
 *
 * `alt` is empty where a link around it already carries the name.
 */
export function SponsorLogo({
  sponsor,
  mobile,
  desktop = mobile,
  alt,
}: {
  sponsor: Pick<PublicSponsor, 'logoUrl' | 'logoWidth' | 'logoHeight'>;
  mobile: LogoBox;
  /** Omitted: the same box at every width (the footer). */
  desktop?: LogoBox;
  alt: string;
}) {
  const aspect = sponsor.logoWidth / sponsor.logoHeight;
  const sm = fitLogo(aspect, mobile);
  const lg = fitLogo(aspect, desktop);
  const style: StyleWithVars = {
    '--w': `${sm.w}px`,
    '--h': `${sm.h}px`,
    '--lw': `${lg.w}px`,
    '--lh': `${lg.h}px`,
  };
  return (
    // Plain <img>: logos live on the storage host, which next/image's
    // allow-list does not know, and they are drawn at a computed size.
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={sponsor.logoUrl}
      alt={alt}
      width={sm.w}
      height={sm.h}
      loading="lazy"
      decoding="async"
      className="block h-(--h) w-(--w) max-w-full object-contain lg:h-(--lh) lg:w-(--lw)"
      style={style}
    />
  );
}

/**
 * The frame around a logo: a link to the sponsor's site in a new tab, or —
 * with no website — a plain box whose logo carries the name as its alt
 * text. `linkClassName` is the hover state, which only a link gets.
 */
export function SponsorMark({
  sponsor,
  mobile,
  desktop,
  className,
  linkClassName,
  style,
}: {
  sponsor: PublicSponsor;
  mobile: LogoBox;
  desktop?: LogoBox;
  className: string;
  linkClassName?: string;
  style?: StyleWithVars;
}) {
  const logo = (alt: string): ReactNode => (
    <SponsorLogo sponsor={sponsor} mobile={mobile} desktop={desktop} alt={alt} />
  );
  if (!sponsor.websiteUrl) {
    return (
      <div className={className} style={style}>
        {logo(sponsor.name)}
      </div>
    );
  }
  return (
    <a
      href={sponsor.websiteUrl}
      target="_blank"
      rel={SPONSOR_LINK_REL}
      aria-label={sponsorLinkLabel(sponsor.name)}
      title={sponsor.name}
      className={cn(className, linkClassName)}
      style={style}
    >
      {logo('')}
    </a>
  );
}

/** N10 tile surface: neutral card, or charcoal for a logo drawn for dark backgrounds. */
export const SPONSOR_TILE_TONE = {
  light: 'border-border bg-card',
  dark: 'border-foreground bg-foreground',
} as const;

/** The CSS variables for a box's fixed height at both breakpoints. */
export function tileHeightVars(boxes: {
  mobile: GridTileBox;
  desktop: GridTileBox;
}): StyleWithVars {
  return { '--th': `${boxes.mobile.h}px`, '--lth': `${boxes.desktop.h}px` };
}

/**
 * A Partner or Supporter tile in "Supported by": fixed height for its
 * level, full width of its grid column, the logo fitted inside. The hover
 * shadow gives way to the ADR-031 focus ring (globals.css) when both apply.
 */
export function SponsorTile({ sponsor }: { sponsor: PublicSponsor }) {
  const boxes = SPONSOR_LOGO_BOXES[sponsor.level];
  return (
    <SponsorMark
      sponsor={sponsor}
      mobile={boxes.mobile}
      desktop={boxes.desktop}
      className={cn(
        'flex h-(--th) min-w-0 items-center justify-center rounded-[8px] border lg:h-(--lth)',
        SPONSOR_TILE_TONE[sponsor.tileTone],
      )}
      linkClassName="transition-shadow hover:shadow-md"
      style={tileHeightVars(boxes)}
    />
  );
}
