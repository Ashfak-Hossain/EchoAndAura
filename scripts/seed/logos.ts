import type { SeedSponsor, SponsorMark } from './plan';

/**
 * A placeholder logo per seeded sponsor, drawn the way the Canvas 6
 * design's `logoSrc()` draws its samples (home-page.dc.html): a coloured
 * mark and the name as an uppercase wordmark, on a viewBox of
 * (100 × aspect) × 100 — so the tile formula sees the shape the plan asks
 * for. Only xmlns, a viewBox, shapes and text: it passes `inspectLogo`, and
 * the runner uploads it through the sponsors service exactly as the admin
 * form does (tests/unit/seed-plan.test.ts checks every one).
 */

const H = 100;
const CHARCOAL = '#1C1A17';
const FONT = 'Arial,Helvetica,sans-serif';

function escapeXml(s: string): string {
  return s.replace(/[<>&'"]/g, (c) => `&#${c.charCodeAt(0)};`);
}

/** At most two decimals: the design's arithmetic leaves 7.920000000000001. */
function n(x: number): string {
  return String(Math.round(x * 100) / 100);
}

/** The mark in an m × m box at (x, y). */
function markSvg(mark: SponsorMark, x: number, y: number, m: number, fill: string): string {
  switch (mark) {
    case 'circle':
      return `<circle cx="${n(x + m / 2)}" cy="${n(y + m / 2)}" r="${n(m / 2)}" fill="${fill}"/>`;
    case 'square':
      return `<rect x="${n(x)}" y="${n(y)}" width="${m}" height="${m}" rx="${n(m * 0.18)}" fill="${fill}"/>`;
    case 'tri':
      return `<path d="M${n(x)} ${n(y + m)}L${n(x + m / 2)} ${n(y)}L${n(x + m)} ${n(y + m)}Z" fill="${fill}"/>`;
    case 'ring':
      return `<circle cx="${n(x + m / 2)}" cy="${n(y + m / 2)}" r="${n(m * 0.38)}" fill="none" stroke="${fill}" stroke-width="${n(m * 0.22)}"/>`;
    case 'bars':
      // Four bars, alternately short and tall, like a level meter.
      return [0, 1, 2, 3]
        .map((i) => {
          const tall = i % 2 === 1;
          return `<rect x="${n(x + i * m * 0.27)}" y="${n(y + m * (tall ? 0.08 : 0.3))}" width="${n(m * 0.17)}" height="${n(m * (tall ? 0.84 : 0.4))}" rx="${n(m * 0.08)}" fill="${fill}"/>`;
        })
        .join('');
  }
}

export function logoSvg(sponsor: SeedSponsor): string {
  const W = Math.round(H * sponsor.aspect);
  const ink = sponsor.ink ?? CHARCOAL;
  const word = (sponsor.wordmark ?? sponsor.name).toUpperCase();
  const text = (x: number, y: number, size: number, anchor = '') =>
    `<text x="${n(x)}" y="${n(y)}"${anchor} font-family="${FONT}" font-weight="700" font-size="${size.toFixed(1)}" fill="${ink}">${escapeXml(word)}</text>`;

  let body: string;
  if (sponsor.aspect < 1.4) {
    // Near-square: the mark centred on top, the wordmark underneath.
    const m = 44;
    const size = Math.min(15, (W - 10) / (word.length * 0.7));
    body =
      markSvg(sponsor.mark, (W - m) / 2, 12, m, sponsor.colour) +
      text(W / 2, 86, size, ' text-anchor="middle"');
  } else {
    // Wide: the mark on the left, the wordmark filling the rest.
    const m = 56;
    const tx = m + 18;
    const size = Math.min(44, (W - tx - 6) / (word.length * 0.7));
    body =
      markSvg(sponsor.mark, 4, (H - m) / 2, m, sponsor.colour) +
      text(tx, H / 2 + size * 0.36, size);
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}">${body}</svg>`;
}

/** The upload the admin form would send for this logo. */
export function logoUpload(sponsor: SeedSponsor): { bytes: Uint8Array; contentType: string } {
  return { bytes: new TextEncoder().encode(logoSvg(sponsor)), contentType: 'image/svg+xml' };
}
