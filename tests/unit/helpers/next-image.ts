/**
 * Covers render through next/image (ADR-033), so an <img> src is the
 * optimizer's `/_next/image?url=<storage URL>&w=…&q=…`. These read the
 * storage URL back out, so tests keep asserting on which cover is shown.
 */

/** The storage URL behind one optimizer src; null when it is not one. */
export function optimizedSource(src: string): string | null {
  const decoded = src.replaceAll('&amp;', '&');
  if (!decoded.startsWith('/_next/image?')) return null;
  return new URLSearchParams(decoded.slice('/_next/image?'.length)).get('url');
}

/** The storage URL behind every <img> in rendered markup, in order. */
export function coverSources(html: string): (string | null)[] {
  return [...html.matchAll(/<img [^>]*?\bsrc="([^"]*)"/g)].map((m) => optimizedSource(m[1]!));
}
