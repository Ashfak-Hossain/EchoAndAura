import sharp from 'sharp';
import { formatInTimeZone } from 'date-fns-tz';
import { DHAKA_TZ } from '@/lib/time';
import type { SeedEvent } from './plan';

/**
 * A designed placeholder cover per seeded event: 1200×750 (16:10, the
 * public cards' ratio), a dark gradient in the event's hue, the title large,
 * date and (public) place below, the wordmark in a corner. SVG → WebP with
 * sharp. A private venue's cover shows the public area, never the venue.
 */

const W = 1200;
const H = 750;

function escapeXml(s: string): string {
  return s.replace(/[<>&'"]/g, (c) => `&#${c.charCodeAt(0)};`);
}

/** Greedy word wrap for the title, at most three lines. */
function wrap(title: string, perLine: number): string[] {
  const lines: string[] = [];
  let line = '';
  for (const word of title.split(/\s+/)) {
    if ((line + ' ' + word).trim().length > perLine && line) {
      lines.push(line);
      line = word;
    } else {
      line = (line + ' ' + word).trim();
    }
  }
  if (line) lines.push(line);
  return lines.slice(0, 3);
}

export function coverSvg(event: SeedEvent): string {
  const h = event.hue;
  const place = event.venueHidden ? (event.venueArea ?? 'Dhaka') : event.venue.split(',')[0]!;
  const date = formatInTimeZone(event.startsAt, DHAKA_TZ, 'EEE d MMM yyyy · h:mm a');
  const lines = wrap(event.title, 20);
  const size = lines.length > 2 ? 78 : 92;
  const top = H - 150 - lines.length * (size + 6);
  const title = lines
    .map(
      (l, i) =>
        `<text x="72" y="${top + i * (size + 6)}" font-size="${size}" font-weight="800" letter-spacing="-2" fill="#fbfaf8">${escapeXml(l)}</text>`,
    )
    .join('');

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
  <defs>
    <radialGradient id="glow" cx="72%" cy="30%" r="75%">
      <stop offset="0%" stop-color="hsl(${h} 70% 55%)" stop-opacity="0.95"/>
      <stop offset="45%" stop-color="hsl(${h} 55% 24%)"/>
      <stop offset="100%" stop-color="hsl(${(h + 20) % 360} 35% 7%)"/>
    </radialGradient>
    <linearGradient id="shade" x1="0" y1="0" x2="0" y2="1">
      <stop offset="40%" stop-color="#14120f" stop-opacity="0"/>
      <stop offset="100%" stop-color="#14120f" stop-opacity="0.85"/>
    </linearGradient>
  </defs>
  <rect width="${W}" height="${H}" fill="url(#glow)"/>
  <g stroke="hsl(${h} 80% 70%)" stroke-opacity="0.18" fill="none">
    <circle cx="900" cy="220" r="160"/><circle cx="900" cy="220" r="250"/><circle cx="900" cy="220" r="340"/>
  </g>
  <rect width="${W}" height="${H}" fill="url(#shade)"/>
  <g font-family="Helvetica Neue, Helvetica, Arial, sans-serif">
    <text x="72" y="92" font-size="26" font-weight="700" letter-spacing="1" fill="#fbfaf8" fill-opacity="0.85">echoandaura</text>
    ${title}
    <text x="72" y="${H - 96}" font-size="32" font-weight="600" fill="#eda43c">${escapeXml(date)}</text>
    <text x="72" y="${H - 52}" font-size="28" fill="#e6e1d6">${escapeXml(place)}</text>
  </g>
</svg>`;
}

export async function renderCover(event: SeedEvent): Promise<Buffer> {
  return sharp(Buffer.from(coverSvg(event)))
    .webp({ quality: 82 })
    .toBuffer();
}
