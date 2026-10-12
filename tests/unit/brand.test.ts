import { readFileSync } from 'node:fs';
import { createElement as h } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { render } from '@react-email/components';
import { describe, expect, it } from 'vitest';
import { BrandLogo, BrandMark } from '@/components/brand';
import { BRAND_COLORS, EMAIL_LOGO, LOCKUP, MARK, MARK_SMALL, WORDMARK } from '@/lib/brand/marks';
import { docsBrandModule, faviconSvg, lockupSvg } from '@/lib/brand/svg';
import manifest from '@/app/manifest';
import { EmailLayout } from '@/server/email/templates/layout';
import type { EmailSender } from '@/server/email/templates/view';

const box = (viewBox: string) => viewBox.split(' ').map(Number);

// docs/BRAND.md: one source of truth for the mark and the wordmark.
describe('brand data', () => {
  it('has a full mark with the echo arc and a small cut without it', () => {
    expect(MARK.arc).not.toBeNull();
    expect(MARK_SMALL.arc).toBeNull();
    for (const mark of [MARK, MARK_SMALL]) expect(box(mark.viewBox)).toHaveLength(4);
  });

  it('outlines "echo&aura" with exactly one accent part, the ampersand, in the middle', () => {
    expect(WORDMARK.parts.map((p) => p.role)).toEqual(['ink', 'accent', 'ink']);
    for (const part of WORDMARK.parts) expect(part.d).toMatch(/^M[\d.-]/);
  });

  it('derives the lockup from the parts: mark 1.8x the wordmark height, centred', () => {
    const [, wy, , wh] = box(WORDMARK.viewBox) as [number, number, number, number];
    const [, top, , height] = box(LOCKUP.viewBox) as [number, number, number, number];
    expect(height).toBeCloseTo(1.8 * wh, 1);
    expect(top + height / 2).toBeCloseTo(wy + wh / 2, 1);
  });
});

describe('web components', () => {
  it('draw the ink in currentColor and the dot and ampersand in marigold', () => {
    const logo = renderToStaticMarkup(h(BrandLogo, {}));
    expect(logo).toContain('stroke="currentColor"');
    expect(logo.match(new RegExp(`fill="${BRAND_COLORS.marigold}"`, 'g'))).toHaveLength(2);
    expect(logo).toContain(`viewBox="${LOCKUP.viewBox}"`);
  });

  it('go one colour when mono', () => {
    const logo = renderToStaticMarkup(h(BrandLogo, { mono: true }));
    expect(logo).not.toContain(BRAND_COLORS.marigold);
  });

  it('are decorative unless given a title, then a named image', () => {
    expect(renderToStaticMarkup(h(BrandMark, {}))).toContain('aria-hidden="true"');
    const named = renderToStaticMarkup(h(BrandLogo, { title: 'echoandaura' }));
    expect(named).toContain('role="img"');
    expect(named).toContain('aria-label="echoandaura"');
    expect(named).not.toContain('aria-hidden');
  });

  it('use the small cut, without the arc, when asked', () => {
    const small = renderToStaticMarkup(h(BrandMark, { small: true }));
    expect(small).toContain(MARK_SMALL.curl.d);
    expect(small).not.toContain(MARK.arc!.d);
  });
});

describe('icons', () => {
  it('build the favicon tile from the small cut, all marigold on charcoal', () => {
    const svg = faviconSvg();
    expect(svg).toContain(MARK_SMALL.curl.d);
    expect(svg).toContain(`fill="${BRAND_COLORS.ink}"`);
    expect(svg).not.toContain(MARK.arc!.d);
  });

  it('ship favicon.ico as 16, 32 and 48 px PNG frames (pnpm brand:assets)', () => {
    const ico = readFileSync('src/app/favicon.ico');
    expect(ico.readUInt16LE(2)).toBe(1);
    const count = ico.readUInt16LE(4);
    const sizes = Array.from({ length: count }, (_, i) => ico.readUInt8(6 + 16 * i));
    expect(sizes).toEqual([16, 32, 48]);
    for (let i = 0; i < count; i++) {
      const offset = ico.readUInt32LE(6 + 16 * i + 12);
      expect(ico.subarray(offset + 1, offset + 4).toString('latin1')).toBe('PNG');
    }
  });

  it('list the app icon for any and maskable use', () => {
    const icons = manifest().icons ?? [];
    expect(icons.filter((i) => i.src === '/icon').map((i) => i.purpose)).toEqual([
      'any',
      'maskable',
    ]);
  });
});

// `pnpm brand:assets` writes these; each test fails when its file is stale.
describe('generated brand files', () => {
  it('ship the emailed logo as a 3x PNG of the size the email shows', () => {
    const png = readFileSync(`public${EMAIL_LOGO.path}`);
    expect(png.subarray(1, 4).toString('latin1')).toBe('PNG');
    expect([png.readUInt32BE(16), png.readUInt32BE(20)]).toEqual([
      EMAIL_LOGO.width * EMAIL_LOGO.scale,
      EMAIL_LOGO.height * EMAIL_LOGO.scale,
    ]);
  });

  it('draw the emailed lockup on white with the two marigold accents', () => {
    const svg = lockupSvg({ width: 3, height: 1, background: '#ffffff' });
    expect(svg).toContain('fill="#ffffff"');
    expect(svg.match(new RegExp(`fill="${BRAND_COLORS.marigold}"`, 'g'))).toHaveLength(2);
  });

  it('give the docs site the same favicon and an exact copy of the brand data', () => {
    expect(readFileSync('docs-site/app/icon.svg', 'utf8')).toBe(faviconSvg());
    expect(readFileSync('docs-site/lib/brand.generated.ts', 'utf8')).toBe(docsBrandModule());
  });
});

describe('email header', () => {
  it('shows the hosted logo at its display size, named for blocked images', async () => {
    const sender: EmailSender = {
      siteUrl: 'https://echoandaura.com',
      contactEmail: null,
      contactPhone: null,
      organizerName: 'Raj',
      organizerAddress: null,
    };
    const html = await render(h(EmailLayout, { preview: 'p', sender, children: 'body' }));
    const img = /<img[^>]*>/.exec(html)?.[0] ?? '';
    expect(img).toContain('src="https://echoandaura.com/brand/email-logo.png"');
    expect(img).toContain(`width="${EMAIL_LOGO.width}"`);
    expect(img).toContain(`height="${EMAIL_LOGO.height}"`);
    expect(img).toContain('alt="echoandaura"');
  });
});
