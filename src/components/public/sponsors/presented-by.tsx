import type { PublicSponsor } from '@/server/services/sponsors.service';
import { SPONSOR_LOGO_BOXES } from '@/lib/sponsor-fit';
import { cn } from '@/lib/utils';
import { SPONSOR_LINK_REL, SponsorLogo } from './sponsor-tile';

/**
 * The logo tile keeps the sponsor's own tone on the dark band: a light
 * logo stays on white; a logo drawn for dark backgrounds sits on charcoal,
 * outlined so the tile still reads as one.
 */
const TILE_TONE = {
  light: 'border-white bg-white',
  dark: 'border-white/15 bg-foreground',
} as const;

/**
 * N11 "Presented by", adapted to the event page's dark title band (Canvas
 * 6, S2 draws it on a light page): a translucent card with the sponsor's
 * 112×48 logo tile, the overline and the name. Props only — the page
 * decides whether there is an active presenter to show.
 *
 * With a website it is a link to it in a new tab. Like the presenting
 * card in "Supported by", the link is named by its visible text ("Presented
 * by", the name) plus a hidden "(opens in a new tab)", not an aria-label:
 * a screen reader hears why the sponsor is here, and the name a voice user
 * reads off the screen is the link's name. The logo's alt stays empty
 * because the name is already text. Without a website it is a plain card.
 */
export function PresentedBy({ sponsor }: { sponsor: PublicSponsor }) {
  const box = SPONSOR_LOGO_BOXES.presentedBy;
  const url = sponsor.websiteUrl;
  const frame =
    'inline-flex min-h-11 max-w-full items-center gap-3 self-start rounded-[12px] border border-white/15 bg-white/5 py-2 pr-4 pl-2 text-[#fbfaf8]';

  const body = (
    <>
      <span
        className={cn(
          'flex shrink-0 items-center justify-center rounded-[8px] border',
          TILE_TONE[sponsor.tileTone],
        )}
        style={{ width: box.w, height: box.h }}
      >
        <SponsorLogo sponsor={sponsor} mobile={box} alt="" />
      </span>
      <span className="flex min-w-0 flex-col gap-0.5">
        <span className="text-xs font-medium tracking-[0.14em] text-[#a8a29a] uppercase">
          Presented by
        </span>{' '}
        {/* The space keeps "Presented by" and the name apart in the link's name. */}
        <span className="text-base leading-snug font-semibold wrap-anywhere">
          {sponsor.name}
          {url ? (
            <>
              <span aria-hidden="true" className="font-normal text-[#a8a29a]">
                &nbsp;↗
              </span>
              <span className="sr-only"> (opens in a new tab)</span>
            </>
          ) : null}
        </span>
      </span>
    </>
  );

  if (!url) {
    return (
      <div className={frame} data-testid="presented-by">
        {body}
      </div>
    );
  }
  return (
    <a
      href={url}
      target="_blank"
      rel={SPONSOR_LINK_REL}
      data-testid="presented-by"
      className={cn(
        frame,
        'transition-colors hover:bg-white/10',
        // ADR-031's ring; the event page is outside the scoped rule.
        'focus-visible:shadow-[0_0_0_2px_var(--foreground)] focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-marigold',
      )}
    >
      {body}
    </a>
  );
}
