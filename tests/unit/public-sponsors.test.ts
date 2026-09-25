import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { PublicSponsor } from '@/server/services/sponsors.service';
import { FooterSponsors } from '@/components/public/sponsors/footer-sponsors';
import { PresentedBy } from '@/components/public/sponsors/presented-by';
import { SupportedBy } from '@/components/public/sponsors/supported-by';

const sponsor = (over: Partial<PublicSponsor> = {}): PublicSponsor => ({
  id: 'sp-nodi',
  name: 'Nodi Coffee',
  websiteUrl: 'https://nodi.example',
  level: 'partner',
  tileTone: 'light',
  logoUrl: 'https://cdn.test/sponsors/sp-nodi/logo-a.svg',
  // A 7:1 wordmark: wide enough that the max width, not the area, sizes it.
  logoWidth: 700,
  logoHeight: 100,
  ...over,
});

const kolorob = sponsor({
  id: 'sp-kolorob',
  name: 'Kolorob Audio',
  websiteUrl: 'https://www.kolorob.example/about',
  level: 'presenting',
  logoWidth: 300,
  logoHeight: 100,
});
const nodi = sponsor();
const megh = sponsor({ id: 'sp-megh', name: 'Megh Stage', tileTone: 'dark' });
const bhor = sponsor({
  id: 'sp-bhor',
  name: 'Bhor FM',
  level: 'supporter',
  logoWidth: 64,
  logoHeight: 64,
});
const tinTala = sponsor({
  id: 'sp-tin',
  name: 'Tin Tala Café',
  level: 'supporter',
  websiteUrl: null,
});
const all = [kolorob, nodi, megh, bhor, tinTala];

const html = (el: Parameters<typeof renderToStaticMarkup>[0]) => renderToStaticMarkup(el);
const supportedBy = (sponsors: PublicSponsor[]) => html(createElement(SupportedBy, { sponsors }));
const footerRow = (sponsors: PublicSponsor[]) => html(createElement(FooterSponsors, { sponsors }));
const presentedBy = (sponsor: PublicSponsor) => html(createElement(PresentedBy, { sponsor }));

/** The markup of the `<li>` that draws one sponsor, found by a string only it contains. */
const itemWith = (out: string, needle: string) => {
  const item = out.split('<li').find((chunk) => chunk.includes(needle));
  if (!item) throw new Error(`no item with ${needle}`);
  return item;
};

describe('SupportedBy (S1)', () => {
  it('renders nothing when no sponsor is active — not even the heading', () => {
    expect(supportedBy([])).toBe('');
  });

  it('is a named section with the heading and the sponsor-a-night link', () => {
    const out = supportedBy(all);
    expect(out).toMatch(/^<section aria-labelledby="supported-by-heading"/);
    expect(out).toMatch(/<h2 id="supported-by-heading"[^>]*>Supported by<\/h2>/);
    expect(out).toMatch(
      /<a [^>]*href="\/contact"[^>]*>Want to sponsor a night\? Get in touch →<\/a>/,
    );
  });

  it('shows the presenting partner as a card, named by its own text', () => {
    const out = supportedBy(all);
    const card = out.match(/<a href="https:\/\/www\.kolorob\.example\/about"[^>]*>(.*?)<\/a>/);
    expect(card).not.toBeNull();
    expect(card?.[0]).toContain('target="_blank" rel="sponsored noopener"');
    // No aria-label: the visible text names it, so the level is announced too.
    expect(card?.[0]).not.toContain('aria-label');
    const body = card?.[1] ?? '';
    expect(body).toContain('Presenting partner');
    expect(body).toContain('Kolorob Audio');
    // The site, not the page, and without the www.
    expect(body).toContain('kolorob.example<span aria-hidden="true">');
    expect(body).not.toContain('/about');
    expect(body).toContain('<span class="sr-only"> (opens in a new tab)</span>');
    expect(body).toMatch(/<img [^>]*alt=""/);
    // 3:1 in the presenting box: 170×57 on phones, 226×75 from lg; the logo box is 128 / 176 high.
    expect(body).toContain('style="--w:170px;--h:57px;--lw:226px;--lh:75px"');
    expect(body).toContain('style="--th:128px;--lth:176px"');
  });

  it('groups partners and supporters under their overlines, in display order', () => {
    const out = supportedBy(all);
    const partners = out.indexOf('>Partners</h3>');
    const supporters = out.indexOf('>Supporters</h3>');
    expect(partners).toBeGreaterThan(out.indexOf('Kolorob Audio'));
    expect(supporters).toBeGreaterThan(partners);
    expect(out.indexOf('Nodi Coffee')).toBeGreaterThan(partners);
    expect(out.indexOf('Megh Stage')).toBeGreaterThan(out.indexOf('Nodi Coffee'));
    expect(out.indexOf('Bhor FM')).toBeGreaterThan(supporters);
    expect(out).toMatch(/<ul class="grid gap-3 grid-cols-2 lg:grid-cols-4">/);
    expect(out).toMatch(/<ul class="grid gap-3 grid-cols-3 lg:grid-cols-6">/);
  });

  it('a tile with a website is one labelled link that opens a new tab', () => {
    const tile = itemWith(supportedBy(all), 'Nodi Coffee');
    expect(tile).toContain(
      '<a href="https://nodi.example" target="_blank" rel="sponsored noopener" aria-label="Nodi Coffee (opens in a new tab)" title="Nodi Coffee"',
    );
    expect(tile).toContain('hover:shadow-md');
    expect(tile).toMatch(/<img [^>]*alt=""/);
  });

  it('sizes each logo exactly at both breakpoints through CSS variables', () => {
    const out = supportedBy(all);
    const partner = itemWith(out, 'Nodi Coffee');
    // 7:1 partner: capped by the max width — 128×18 on phones, 176×25 from lg.
    expect(partner).toContain('style="--w:128px;--h:18px;--lw:176px;--lh:25px"');
    expect(partner).toContain('width="128" height="18"');
    expect(partner).toContain('h-(--h) w-(--w)');
    expect(partner).toContain('lg:h-(--lh) lg:w-(--lw)');
    expect(partner).toContain('object-contain');
    expect(partner).toContain('loading="lazy" decoding="async"');
    // Partner tiles are 96 / 112 high.
    expect(partner).toContain('style="--th:96px;--lth:112px"');

    const supporter = itemWith(out, 'Bhor FM');
    // Square supporter: 30×30 / 40×40, in an 80 / 88 tile.
    expect(supporter).toContain('style="--w:30px;--h:30px;--lw:40px;--lh:40px"');
    expect(supporter).toContain('style="--th:80px;--lth:88px"');
  });

  it('a sponsor without a website is a plain tile: no link, no hover, the logo is named', () => {
    const tile = itemWith(supportedBy(all), 'Tin Tala Café');
    expect(tile).not.toContain('<a ');
    expect(tile).not.toContain('hover:');
    expect(tile).toMatch(/<img [^>]*alt="Tin Tala Café"/);
  });

  it('draws a dark-tone logo on a charcoal tile', () => {
    const out = supportedBy(all);
    expect(itemWith(out, 'Megh Stage')).toContain('border-foreground bg-foreground');
    expect(itemWith(out, 'Nodi Coffee')).toContain('border-border bg-card');
  });

  it('leaves out the card and any group with nobody in it', () => {
    const onlyPresenting = supportedBy([kolorob]);
    expect(onlyPresenting).toContain('Presenting partner');
    expect(onlyPresenting).not.toContain('Partners');
    expect(onlyPresenting).not.toContain('Supporters');

    const onlySupporters = supportedBy([bhor]);
    expect(onlySupporters).not.toContain('Presenting partner');
    expect(onlySupporters).not.toContain('Partners');
    expect(onlySupporters).toContain('>Supporters</h3>');
  });

  it('a presenting partner without a website is a card, not a link', () => {
    const out = supportedBy([{ ...kolorob, websiteUrl: null }]);
    expect(out).toContain('Kolorob Audio');
    expect(out).not.toContain('sponsored noopener');
    expect(out).not.toContain('opens in a new tab');
    // The name is already on the card as text.
    expect(out).toMatch(/<img [^>]*alt=""/);
  });
});

describe('FooterSponsors (N12)', () => {
  it('renders nothing when no sponsor is active', () => {
    expect(footerRow([])).toBe('');
  });

  it('lists every active sponsor in display order, presenting partner first', () => {
    const out = footerRow(all);
    expect(out).toMatch(/<h2 [^>]*>Supported by<\/h2>/);
    const names = ['Kolorob Audio', 'Nodi Coffee', 'Megh Stage', 'Bhor FM', 'Tin Tala Café'];
    const at = names.map((n) => out.indexOf(n));
    expect(at.every((i) => i > 0)).toBe(true);
    expect([...at].sort((a, b) => a - b)).toEqual(at);
  });

  it('draws 96×44 tiles with the logo fitted to the footer box', () => {
    const tile = itemWith(footerRow(all), 'Nodi Coffee');
    expect(tile).toContain('style="width:96px;height:44px"');
    // 7:1 in the 80×24 footer box, the same at every width.
    expect(tile).toContain('style="--w:80px;--h:11px;--lw:80px;--lh:11px"');
    expect(tile).toContain(
      'target="_blank" rel="sponsored noopener" aria-label="Nodi Coffee (opens in a new tab)" title="Nodi Coffee"',
    );
    // On the charcoal band a light tile is white; hover changes the border, never a shadow.
    expect(tile).toContain('border-white bg-white');
    expect(tile).toContain('hover:border-[#e6e1d6]');
    expect(tile).not.toContain('shadow');
  });

  it('a dark tile is charcoal with a visible edge; no website means no link', () => {
    const out = footerRow(all);
    expect(itemWith(out, 'Megh Stage')).toContain('border-[#33302a] bg-foreground');
    const plain = itemWith(out, 'Tin Tala Café');
    expect(plain).not.toContain('<a ');
    expect(plain).toMatch(/<img [^>]*alt="Tin Tala Café"/);
  });
});

describe('PresentedBy (N11, dark-band variant)', () => {
  it('with a website: one link to it in a new tab, named by its text', () => {
    const out = presentedBy(kolorob);
    expect(out).toMatch(
      /^<a href="https:\/\/www\.kolorob\.example\/about" target="_blank" rel="sponsored noopener"/,
    );
    expect(out.match(/<a /g)).toHaveLength(1);
    // Named by "Presented by", the name and the hidden new-tab note — the
    // overline and the name are separate words in that name.
    expect(out).not.toContain('aria-label');
    expect(out).toContain('Presented by</span> <span');
    expect(out).toContain('Kolorob Audio');
    expect(out).toContain(
      '<span aria-hidden="true" class="font-normal text-[#a8a29a]">\u00a0↗</span>',
    );
    expect(out).toContain('<span class="sr-only"> (opens in a new tab)</span>');
    // The name is text already, so the logo is decoration; hover lightens the card.
    expect(out).toMatch(/<img [^>]*alt=""/);
    expect(out).toContain('hover:bg-white/10');
    expect(out).toContain('focus-visible:outline-marigold');
  });

  it('fits the logo to the 92×32 box inside a 112×48 tile', () => {
    // 3:1 at area 1900: 75×25, inside the max box.
    const wordmark = presentedBy(kolorob);
    expect(wordmark).toContain('style="width:112px;height:48px"');
    expect(wordmark).toContain('style="--w:75px;--h:25px;--lw:75px;--lh:25px"');
    // 7:1: the max width caps it at 92.
    expect(presentedBy(nodi)).toContain('style="--w:92px;--h:13px;--lw:92px;--lh:13px"');
  });

  it('without a website: a plain card — no link, no arrow, no new-tab note', () => {
    const out = presentedBy(tinTala);
    expect(out).toMatch(/^<div /);
    expect(out).not.toContain('<a ');
    expect(out).not.toContain('↗');
    expect(out).not.toContain('opens in a new tab');
    expect(out).not.toContain('hover:');
    expect(out).toContain('Presented by');
    expect(out).toContain('Tin Tala Café');
  });

  it('keeps the sponsor’s tile tone on the dark band', () => {
    // A light logo stays on white; a dark-tone logo sits on charcoal with a faint edge.
    expect(presentedBy(kolorob)).toContain('border-white bg-white');
    const dark = presentedBy(megh);
    expect(dark).toContain('border-white/15 bg-foreground');
    expect(dark).not.toContain('border-white bg-white');
  });
});
