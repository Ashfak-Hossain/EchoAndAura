import { BRAND_COLORS, MARK_SMALL, type Mark } from './marks';

/** A mark's shapes as SVG markup, in one ink with the given dot colour. */
export function markShapes(mark: Mark, ink: string, dot: string): string {
  const stroke = (s: { d: string; width: number }) =>
    `<path d="${s.d}" fill="none" stroke="${ink}" stroke-width="${s.width}" stroke-linecap="round" stroke-linejoin="round"/>`;
  return (
    stroke(mark.curl) +
    (mark.arc ? stroke(mark.arc) : '') +
    `<circle cx="${mark.dot.cx}" cy="${mark.dot.cy}" r="${mark.dot.r}" fill="${dot}"/>`
  );
}

/**
 * The favicon tile (docs/BRAND.md): the small cut, all marigold, on a rounded
 * charcoal square. Rendered into favicon.ico by scripts/brand/favicon.mjs.
 */
export function faviconSvg(): string {
  return (
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">' +
    `<rect width="100" height="100" rx="22" fill="${BRAND_COLORS.ink}"/>` +
    `<g transform="translate(15 17) scale(0.7)">${markShapes(MARK_SMALL, BRAND_COLORS.marigold, BRAND_COLORS.marigold)}</g>` +
    '</svg>'
  );
}
