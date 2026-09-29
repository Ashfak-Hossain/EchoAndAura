// The same card as opengraph-image, for X/Twitter (ADR-042). Next reads
// these settings from the file itself, so they are repeated, not re-exported.
export { default } from './opengraph-image';

export const dynamic = 'force-static';
export const alt = 'echoandaura: live events in Dhaka';
export const size = { width: 1200, height: 630 };
export const contentType = 'image/png';
