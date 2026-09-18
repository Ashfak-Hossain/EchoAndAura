import sanitizeHtml from 'sanitize-html';

/**
 * Event descriptions are stored as a small, allowlisted subset of HTML in
 * `events.description` (ADR-010). The column also still holds plain text
 * from before the editor existed, so every reader goes through
 * `descriptionToHtml`, which handles both shapes.
 *
 * Pure: no Next, no DB — usable from the service, the page and the worker.
 */

const OPTIONS: sanitizeHtml.IOptions = {
  allowedTags: [
    'p',
    'br',
    'strong',
    'em',
    's',
    'u',
    'h2',
    'h3',
    'ul',
    'ol',
    'li',
    'blockquote',
    'a',
  ],
  allowedAttributes: { a: ['href', 'rel', 'target'] },
  allowedSchemes: ['http', 'https', 'mailto'],
  allowProtocolRelative: false,
  // Editors may emit <b>/<i>; normalise so the public prose styles apply.
  transformTags: {
    b: 'strong',
    i: 'em',
    h1: 'h2',
    h4: 'h3',
    a: (tagName, attribs) => ({
      tagName,
      attribs: { ...attribs, rel: 'noopener noreferrer', target: '_blank' },
    }),
  },
  // Drop the *content* of dangerous elements, not just their tags.
  nonTextTags: ['script', 'style', 'textarea', 'option', 'iframe', 'object', 'embed'],
};

/** Matches paragraphs that hold nothing but whitespace or line breaks. */
const EMPTY_BLOCK = /<(p|h2|h3|blockquote)>(\s|&nbsp;|<br\s*\/?>)*<\/\1>/g;

/**
 * Allowlist-sanitise editor output. Returns '' when nothing meaningful is
 * left (e.g. an editor that was opened and closed emits `<p></p>`), so
 * callers can store NULL instead of an empty paragraph.
 */
export function sanitizeDescriptionHtml(html: string): string {
  const clean = sanitizeHtml(html, OPTIONS).replace(EMPTY_BLOCK, '').trim();
  return descriptionToPlainText(clean) === '' ? '' : clean;
}

/** Legacy rows are plain text; anything the editor wrote starts with a tag. */
export function looksLikeHtml(raw: string): boolean {
  return /^\s*<[a-z]/i.test(raw);
}

/**
 * The single read path: a stored description → safe HTML for rendering or
 * for seeding the editor. Plain text keeps its blank-line paragraphs, so
 * pre-editor events render exactly as before.
 */
export function descriptionToHtml(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const html = looksLikeHtml(raw) ? sanitizeDescriptionHtml(raw) : plainTextToHtml(raw);
  return html === '' ? null : html;
}

/** For meta descriptions and previews: tags gone, whitespace collapsed. */
export function descriptionToPlainText(raw: string | null | undefined): string {
  if (!raw) return '';
  // Block boundaries become spaces so "<h2>A</h2><p>B</p>" reads "A B".
  const text = looksLikeHtml(raw)
    ? sanitizeHtml(raw.replace(/<\/?(p|h2|h3|li|blockquote|br|ul|ol|div|h1|h4)\b[^>]*>/gi, ' '), {
        allowedTags: [],
        allowedAttributes: {},
        nonTextTags: OPTIONS.nonTextTags,
      })
    : raw;
  return decodeEntities(text).replace(/\s+/g, ' ').trim();
}

function plainTextToHtml(text: string): string {
  return text
    .split(/\n\s*\n/)
    .map((para) => para.trim())
    .filter((para) => para !== '')
    .map((para) => `<p>${escapeHtml(para).replace(/\n/g, '<br>')}</p>`)
    .join('');
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// sanitize-html escapes text nodes; undo the common entities for plain text.
function decodeEntities(text: string): string {
  return text
    .replace(/&nbsp;/g, ' ')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, '&');
}
