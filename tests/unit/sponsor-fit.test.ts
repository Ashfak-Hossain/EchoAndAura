import { describe, expect, it } from 'vitest';
import { type LogoBox, SPONSOR_LOGO_BOXES, fitLogo } from '@/lib/sponsor-fit';

/**
 * N10: every logo gets the same area in its tile, clamped to the max box,
 * never stretched. Expected sizes are the canvas's own `fit()` output.
 */
const partnerDesktop = SPONSOR_LOGO_BOXES.partner.desktop; // 176×56, area 5200

describe('fitLogo', () => {
  it('a 7:1 wordmark is clamped by the box width', () => {
    expect(fitLogo(7, partnerDesktop)).toEqual({ w: 176, h: 25 });
  });

  it('a square mark is clamped by the box height', () => {
    expect(fitLogo(1, partnerDesktop)).toEqual({ w: 56, h: 56 });
  });

  it('a 1:4 crest is clamped by the box height and keeps its shape', () => {
    expect(fitLogo(0.25, partnerDesktop)).toEqual({ w: 14, h: 56 });
  });

  it('k is capped at 1: a logo that fits is sized by area alone, never grown past it', () => {
    const box = SPONSOR_LOGO_BOXES.presenting.desktop; // 320×96, area 17000
    const { w, h } = fitLogo(2, box);
    expect({ w, h }).toEqual({ w: 184, h: 92 });
    expect(w * h).toBeLessThanOrEqual(box.area);
    expect(w * h).toBeGreaterThan(box.area * 0.99);
  });

  it('never throws: a shape that is not a positive number draws as a square', () => {
    const square = fitLogo(1, partnerDesktop);
    for (const aspect of [0, -1, Number.NaN]) {
      expect(fitLogo(aspect, partnerDesktop)).toEqual(square);
    }
  });

  it('clamps absurd shapes to 20:1 so a stored 1e308-wide viewBox cannot break a page', () => {
    expect(fitLogo(Number.POSITIVE_INFINITY, partnerDesktop)).toEqual(fitLogo(20, partnerDesktop));
    expect(fitLogo(1e308 / 0.5, partnerDesktop)).toEqual(fitLogo(20, partnerDesktop));
    expect(fitLogo(1e-9, partnerDesktop)).toEqual(fitLogo(1 / 20, partnerDesktop));
  });
});

describe('SPONSOR_LOGO_BOXES', () => {
  const b = SPONSOR_LOGO_BOXES;
  const all: [string, LogoBox & { h: number; w?: number }][] = [
    ['presenting.desktop', b.presenting.desktop],
    ['presenting.mobile', b.presenting.mobile],
    ['partner.desktop', b.partner.desktop],
    ['partner.mobile', b.partner.mobile],
    ['supporter.desktop', b.supporter.desktop],
    ['supporter.mobile', b.supporter.mobile],
    ['footer', b.footer],
    ['presentedBy', b.presentedBy],
    ['adminThumb', b.adminThumb],
    ['adminPreview', b.adminPreview],
  ];

  it('matches the N10/N11/N12 and B15 sheet', () => {
    expect(b.presenting).toEqual({
      desktop: { h: 176, mw: 320, mh: 96, area: 17000 },
      mobile: { h: 128, mw: 240, mh: 72, area: 9600 },
    });
    expect(b.partner).toEqual({
      desktop: { h: 112, mw: 176, mh: 56, area: 5200 },
      mobile: { h: 96, mw: 128, mh: 44, area: 3400 },
    });
    expect(b.supporter).toEqual({
      desktop: { h: 88, mw: 128, mh: 40, area: 2800 },
      mobile: { h: 80, mw: 84, mh: 30, area: 1500 },
    });
    expect(b.footer).toEqual({ w: 96, h: 44, mw: 80, mh: 24, area: 1300 });
    expect(b.presentedBy).toEqual({ w: 112, h: 48, mw: 92, mh: 32, area: 1900 });
    expect(b.adminThumb).toEqual({ w: 64, h: 40, mw: 52, mh: 26, area: 700 });
    expect(b.adminPreview).toEqual({ h: 112, mw: 150, mh: 56, area: 5200 });
  });

  it.each(all)('%s: the logo box fits its tile and its area is reachable', (_name, box) => {
    expect(box.mh).toBeLessThanOrEqual(box.h);
    if (box.w !== undefined) expect(box.mw).toBeLessThanOrEqual(box.w);
    expect(box.area).toBeLessThanOrEqual(box.mw * box.mh);
    // Any plausible logo shape lands inside the box.
    for (const aspect of [1 / 8, 1 / 4, 1, 3, 7, 12]) {
      const { w, h } = fitLogo(aspect, box);
      expect(w).toBeLessThanOrEqual(box.mw);
      expect(h).toBeLessThanOrEqual(box.mh);
    }
  });
});
