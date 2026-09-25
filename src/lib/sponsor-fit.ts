/**
 * Sponsor logo sizing (Canvas 6, N10). Logos arrive in every shape — a 7:1
 * wordmark, a square badge, a tall crest — so sizing them to one width or
 * one height makes some shout and others vanish. Instead every logo gets the
 * same *area* in its tile, clamped to the tile's max box:
 *
 *   w = √(area·r), h = √(area/r), k = min(1, maxW/w, maxH/h)
 *
 * where r = logoWidth / logoHeight. k only ever shrinks, so a logo is never
 * stretched past its box. Client-safe: the admin preview runs it too.
 */

/** The logo box inside a tile: max width, max height and the target area, in CSS px. */
export interface LogoBox {
  mw: number;
  mh: number;
  area: number;
}

/** A tile whose height is fixed and whose width comes from the grid column. */
export interface GridTileBox extends LogoBox {
  /** Tile (or, for the presenting card, logo area) height in px. */
  h: number;
}

/** A tile with a fixed width and height (footer, Presented by, admin thumbnail). */
export interface FixedTileBox extends LogoBox {
  w: number;
  h: number;
}

/** Mirrors MAX_LOGO_ASPECT in src/server/lib/sponsor-logo.ts (kept import-free here). */
const ASPECT_LIMIT = 20;

/**
 * Never throws: this runs while rendering the footer on every public page,
 * so a bad stored shape (a row written before the upload check tightened,
 * or by hand) must draw a clamped logo, not take the site down.
 */
export function fitLogo(aspect: number, box: LogoBox): { w: number; h: number } {
  if (Number.isNaN(aspect) || aspect <= 0) aspect = 1;
  aspect = Math.min(ASPECT_LIMIT, Math.max(1 / ASPECT_LIMIT, aspect));
  const w = Math.sqrt(box.area * aspect);
  const h = Math.sqrt(box.area / aspect);
  const k = Math.min(1, box.mw / w, box.mh / h);
  return { w: Math.round(w * k), h: Math.round(h * k) };
}

/**
 * Every sponsor box the site draws, from the N10/N11/N12 sheet and B15.
 * Desktop is `lg` (1024px) and up. One place, so the public tiles and the
 * admin's "as it will appear" preview can never disagree.
 */
export const SPONSOR_LOGO_BOXES = {
  presenting: {
    desktop: { h: 176, mw: 320, mh: 96, area: 17000 },
    mobile: { h: 128, mw: 240, mh: 72, area: 9600 },
  },
  partner: {
    desktop: { h: 112, mw: 176, mh: 56, area: 5200 },
    mobile: { h: 96, mw: 128, mh: 44, area: 3400 },
  },
  supporter: {
    desktop: { h: 88, mw: 128, mh: 40, area: 2800 },
    mobile: { h: 80, mw: 84, mh: 30, area: 1500 },
  },
  /** N12 footer sponsor row: the same size at every width. */
  footer: { w: 96, h: 44, mw: 80, mh: 24, area: 1300 },
  /** N11 "Presented by" on the event page. */
  presentedBy: { w: 112, h: 48, mw: 92, mh: 32, area: 1900 },
  /** B15 list row thumbnail. */
  adminThumb: { w: 64, h: 40, mw: 52, mh: 26, area: 700 },
  /** B15 form preview (light and dark tiles); width follows the preview column. */
  adminPreview: { h: 112, mw: 150, mh: 56, area: 5200 },
} as const satisfies {
  presenting: { desktop: GridTileBox; mobile: GridTileBox };
  partner: { desktop: GridTileBox; mobile: GridTileBox };
  supporter: { desktop: GridTileBox; mobile: GridTileBox };
  footer: FixedTileBox;
  presentedBy: FixedTileBox;
  adminThumb: FixedTileBox;
  adminPreview: GridTileBox;
};
