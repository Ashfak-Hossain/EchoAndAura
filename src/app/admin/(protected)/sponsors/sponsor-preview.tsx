import type { CSSProperties, ReactNode } from 'react';
import type { SponsorLevel, SponsorTileTone } from '@/server/repositories/sponsors.repository';
import { SPONSOR_LEVEL_LABELS } from '@/lib/sponsor-levels';
import { type LogoBox, SPONSOR_LOGO_BOXES, fitLogo } from '@/lib/sponsor-fit';
import { cn } from '@/lib/utils';

/** A logo to draw: its URL (stored, or a blob: URL for a file just chosen) and its shape. */
export interface PreviewLogo {
  src: string;
  width: number;
  height: number;
}

/**
 * B15 preview column: the logo on a light and a dark tile, then at the
 * size and tile it will really get — the level's desktop box and the
 * footer's — computed with the same `fitLogo` the public tiles use, so the
 * preview cannot disagree with the site.
 */
export function SponsorPreview({
  logo,
  level,
  tone,
}: {
  logo: PreviewLogo | null;
  level: SponsorLevel;
  tone: SponsorTileTone;
}) {
  const live = SPONSOR_LOGO_BOXES[level].desktop;
  const footer = SPONSOR_LOGO_BOXES.footer;

  return (
    <section
      aria-labelledby="sponsor-preview-heading"
      className="flex flex-col gap-4 rounded-xl border border-border bg-card p-6 shadow-sm lg:sticky lg:top-6"
      data-testid="sponsor-preview"
    >
      <h2 id="sponsor-preview-heading" className="font-heading text-base font-semibold">
        Preview
      </h2>
      <div className="grid grid-cols-2 gap-3">
        <Labelled label="light tile">
          <Tile tone="light" height={SPONSOR_LOGO_BOXES.adminPreview.h}>
            <Logo logo={logo} box={SPONSOR_LOGO_BOXES.adminPreview} />
          </Tile>
        </Labelled>
        <Labelled label="dark tile">
          <Tile tone="dark" height={SPONSOR_LOGO_BOXES.adminPreview.h}>
            <Logo logo={logo} box={SPONSOR_LOGO_BOXES.adminPreview} />
          </Tile>
        </Labelled>
      </div>
      <Labelled label={`as it will appear · ${SPONSOR_LEVEL_LABELS[level]} · ${tone} tile`}>
        <Tile tone={tone} height={live.h}>
          <Logo logo={logo} box={live} />
        </Tile>
      </Labelled>
      <Labelled label="footer">
        <div className="rounded-lg bg-foreground p-3">
          <span
            className={cn(
              'flex items-center justify-center rounded-sm',
              tone === 'dark' ? 'bg-foreground' : 'bg-card',
            )}
            style={{ width: footer.w, height: footer.h }}
          >
            <Logo logo={logo} box={footer} />
          </span>
        </div>
      </Labelled>
    </section>
  );
}

function Labelled({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-1.5">
      <span className="font-mono text-xs text-muted-foreground">{label}</span>
      {children}
    </div>
  );
}

function Tile({
  tone,
  height,
  children,
}: {
  tone: SponsorTileTone;
  height: number;
  children: ReactNode;
}) {
  return (
    <div
      className={cn(
        'flex items-center justify-center rounded-lg border',
        tone === 'dark' ? 'border-foreground bg-foreground' : 'border-border bg-card',
      )}
      style={{ height }}
    >
      {children}
    </div>
  );
}

function Logo({ logo, box }: { logo: PreviewLogo | null; box: LogoBox }) {
  if (!logo) return null;
  const size = fitLogo(logo.width / logo.height, box);
  const style: CSSProperties = { width: size.w, height: size.h };
  // Plain <img>: a blob: preview, or a small logo (often SVG, which the
  // optimizer refuses) drawn at its exact fitted size (ADR-033).
  // Decorative here — the name is the label.
  // eslint-disable-next-line @next/next/no-img-element
  return <img src={logo.src} alt="" className="block" style={style} />;
}
