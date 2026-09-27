import type { PublicSponsor } from '@/server/services/sponsors.service';
import { SPONSOR_LOGO_BOXES } from '@/lib/sponsor-fit';
import { cn } from '@/lib/utils';
import { SponsorMark } from './sponsor-tile';

/**
 * Footer tile on the charcoal band (N12): light tiles stay white so every
 * logo sits on the surface it was made for; a dark tile blends into the
 * band and is outlined instead.
 */
const FOOTER_TILE_TONE = {
  light: 'border-white bg-white',
  dark: 'border-[#33302a] bg-foreground',
} as const;

/**
 * N12 footer sponsor row: every active sponsor in display order, as small
 * 96×44 tiles, on every public page. Renders nothing when there are none.
 * It sits inside the footer's `.site-chrome`, so its links get the ADR-031
 * focus ring; hover is a border change, never a box-shadow (the ring owns it).
 */
export function FooterSponsors({ sponsors }: { sponsors: PublicSponsor[] }) {
  if (sponsors.length === 0) return null;
  const box = SPONSOR_LOGO_BOXES.footer;
  return (
    <div className="flex flex-col items-start gap-x-5 gap-y-3 border-t border-[#33302a] pt-6 lg:flex-row lg:items-center">
      {/* font-sans: the base layer sets every h2 in Archivo; this is an overline. */}
      <h2 className="shrink-0 font-sans text-xs font-medium tracking-[0.14em] text-[#a8a29a] uppercase">
        Supported by
      </h2>
      <ul className="flex flex-wrap gap-2">
        {sponsors.map((s) => (
          <li key={s.id}>
            <SponsorMark
              sponsor={s}
              mobile={box}
              className={cn(
                'flex items-center justify-center rounded-[4px] border',
                FOOTER_TILE_TONE[s.tileTone],
              )}
              linkClassName="hover:border-[#e6e1d6]"
              style={{ width: box.w, height: box.h }}
            />
          </li>
        ))}
      </ul>
    </div>
  );
}
