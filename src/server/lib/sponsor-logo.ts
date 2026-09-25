/**
 * Sponsor logo rules (plan decision 2). Import-free on purpose: the admin
 * form runs `inspectLogo` on the chosen file for an instant preview, and the
 * server runs it again on the uploaded bytes as the authority.
 *
 * Why the server reads the bytes at all:
 * - the tile sizing formula (src/lib/sponsor-fit.ts) needs the logo's shape;
 * - an SVG is a document, not a picture. Logos are only ever drawn with
 *   `<img>` (no scripts, no network) and stored as an attachment, so this
 *   screen is defence in depth: it keeps a file that *could* do something
 *   when opened elsewhere out of storage entirely. Anything the screen can't
 *   classify with confidence is refused — a real logo export never needs it.
 *
 * The SVG check is a small tokenizer over tags, not a DOM: it has to run
 * the same way in node (tests, server) and in the browser.
 */

/** Accepted MIME types and the file extension each is stored under. */
export const SPONSOR_LOGO_TYPES = {
  'image/svg+xml': 'svg',
  'image/png': 'png',
} as const;

export type SponsorLogoContentType = keyof typeof SPONSOR_LOGO_TYPES;
export type SponsorLogoExt = (typeof SPONSOR_LOGO_TYPES)[SponsorLogoContentType];

/** Fits under the default 1 MB server-action body limit with room for the other fields. */
export const SPONSOR_LOGO_MAX_BYTES = 512 * 1024;

/** A PNG smaller than this blurs in the smallest tile; larger is a photo, not a logo. */
export const PNG_MIN_SIDE = 16;
export const PNG_MAX_SIDE = 4096;
/**
 * Widest (or tallest) shape a logo may have. The tiles size logos by
 * width ÷ height, so an absurd viewBox such as `0 0 1e308 0.5` would
 * overflow to Infinity and break every page that draws the sponsor row.
 */
export const MAX_LOGO_ASPECT = 20;
/** No exporter writes a viewBox side this large; a bigger one is a crafted file. */
const MAX_VIEWBOX_SIDE = 1e6;

export type LogoInspection =
  { ok: true; width: number; height: number; ext: SponsorLogoExt } | { ok: false; reason: string };

const REASONS = {
  type: 'The logo must be an SVG or PNG file.',
  empty: 'The logo file is empty.',
  size: 'The logo must be 512 KB or smaller.',
  png: 'This PNG could not be read. Export it again as a standard PNG.',
  cgbi: 'This PNG uses an Apple-only format. Export it again as a standard PNG.',
  pngSize: `A PNG logo must be ${PNG_MIN_SIDE} to ${PNG_MAX_SIDE} pixels on each side.`,
  svgz: 'Compressed SVG (.svgz) is not supported. Save it as a plain SVG.',
  utf8: 'Save the SVG as UTF-8 text and upload it again.',
  chars: 'The SVG contains characters that are not allowed. Export it again.',
  malformed: 'This SVG could not be read. Export it again from your design tool.',
  doctype: 'The SVG has a DOCTYPE or entity declaration. Export it again without one.',
  entity: 'The SVG uses an entity that is not defined. Export it again from your design tool.',
  stylesheet: 'The SVG links a stylesheet, which is not allowed in a logo.',
  notSvg: 'The file does not start with an <svg> element.',
  xmlns:
    'The SVG is missing xmlns="http://www.w3.org/2000/svg". Export it again as a standalone SVG.',
  namespace: 'The SVG switches to another namespace, which is not allowed in a logo.',
  noViewBox: 'The SVG has no viewBox, so its shape is unknown. Export it again with a viewBox.',
  badViewBox: 'The SVG’s viewBox must be four numbers with a width and height above zero.',
  shape: `A logo can be at most ${MAX_LOGO_ASPECT} times wider than it is tall, or taller than it is wide.`,
  html: 'The SVG contains HTML, which is not allowed in a logo.',
  handler: 'The SVG contains event handlers (on… attributes), which are not allowed in a logo.',
  scriptLink: 'The SVG contains a script link, which is not allowed in a logo.',
  link: 'The SVG links to a file outside itself. Only embedded images and # links are allowed.',
  css: 'The SVG’s styles load something from outside the file, which is not allowed in a logo.',
} as const;

function elementReason(name: string): string {
  return `The SVG contains a <${name.slice(0, 40)}> element, which is not allowed in a logo.`;
}

function isLogoType(type: string): type is SponsorLogoContentType {
  return Object.prototype.hasOwnProperty.call(SPONSOR_LOGO_TYPES, type);
}

export function inspectLogo(bytes: Uint8Array, contentType: string): LogoInspection {
  // "image/svg+xml; charset=utf-8" is still an SVG.
  const type = (contentType.split(';')[0] ?? '').trim().toLowerCase();
  if (!isLogoType(type)) return { ok: false, reason: REASONS.type };
  if (bytes.length === 0) return { ok: false, reason: REASONS.empty };
  if (bytes.length > SPONSOR_LOGO_MAX_BYTES) return { ok: false, reason: REASONS.size };
  return SPONSOR_LOGO_TYPES[type] === 'png' ? inspectPng(bytes) : inspectSvg(bytes);
}

// ---------------------------------------------------------------------------
// PNG: the header is enough — width and height live in IHDR.
// ---------------------------------------------------------------------------

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a] as const;

function readUint32(bytes: Uint8Array, at: number): number {
  return ((bytes[at] << 24) | (bytes[at + 1] << 16) | (bytes[at + 2] << 8) | bytes[at + 3]) >>> 0;
}

function inspectPng(bytes: Uint8Array): LogoInspection {
  // Signature (8) + IHDR length (4) + type (4) + data (13) + CRC (4).
  if (bytes.length < 33 || PNG_SIGNATURE.some((b, i) => bytes[i] !== b)) {
    return { ok: false, reason: REASONS.png };
  }
  const firstChunk = String.fromCharCode(bytes[12], bytes[13], bytes[14], bytes[15]);
  // Apple's iOS asset pipeline writes "CgBI" PNGs: a private chunk before
  // IHDR, BGRA pixels and a raw deflate stream. Only Safari draws them, so
  // they would show as a broken image everywhere else.
  if (firstChunk === 'CgBI') return { ok: false, reason: REASONS.cgbi };
  if (firstChunk !== 'IHDR' || readUint32(bytes, 8) !== 13) {
    return { ok: false, reason: REASONS.png };
  }
  const width = readUint32(bytes, 16);
  const height = readUint32(bytes, 20);
  if (
    width < PNG_MIN_SIDE ||
    height < PNG_MIN_SIDE ||
    width > PNG_MAX_SIDE ||
    height > PNG_MAX_SIDE
  ) {
    return { ok: false, reason: REASONS.pngSize };
  }
  const aspect = width / height;
  if (aspect > MAX_LOGO_ASPECT || aspect < 1 / MAX_LOGO_ASPECT) {
    return { ok: false, reason: REASONS.shape };
  }
  return { ok: true, width, height, ext: 'png' };
}

// ---------------------------------------------------------------------------
// SVG: shape from the viewBox, content from an allowlist.
// ---------------------------------------------------------------------------

const SVG_NS = 'http://www.w3.org/2000/svg';
const XML_NS = 'http://www.w3.org/XML/1998/namespace';
// Compared lowercased: namespace URIs are case-sensitive to a parser, but a
// near-miss spelling has no business in a logo either.
const XHTML_NS = 'http://www.w3.org/1999/xhtml';
const MATHML_NS = 'http://www.w3.org/1998/math/mathml';

/**
 * SVG-namespace elements a logo export may contain (case-sensitive, as XML
 * is). Grouped by kind, one line each, so the list is easy to audit.
 */
// prettier-ignore
const SVG_ELEMENTS: ReadonlySet<string> = new Set([
  'svg', 'g', 'defs', 'use', 'symbol', 'marker',
  'path', 'rect', 'circle', 'ellipse', 'line', 'polyline', 'polygon',
  'text', 'tspan', 'textPath',
  'linearGradient', 'radialGradient', 'stop',
  'clipPath', 'mask', 'pattern', 'image',
  'style', 'title', 'desc', 'metadata',
  'filter', 'feBlend', 'feColorMatrix', 'feComponentTransfer', 'feComposite',
  'feConvolveMatrix', 'feDiffuseLighting', 'feDisplacementMap', 'feDistantLight',
  'feDropShadow', 'feFlood', 'feFuncA', 'feFuncB', 'feFuncG', 'feFuncR',
  'feGaussianBlur', 'feImage', 'feMerge', 'feMergeNode', 'feMorphology', 'feOffset',
  'fePointLight', 'feSpecularLighting', 'feSpotLight', 'feTile', 'feTurbulence',
]);

/**
 * Refused by local name under ANY prefix, lowercased. Editor metadata
 * (sodipodi:*, inkscape:*, rdf:*, cc:*, dc:*) lives in other namespaces and
 * is allowed, but a prefix is only a label — `<dc:script>` bound to the SVG
 * namespace would be a real script — so these names are never trusted.
 * The animation elements are here because they can rewrite an `href`.
 */
// prettier-ignore
const FORBIDDEN_ELEMENTS: ReadonlySet<string> = new Set([
  'script', 'foreignobject', 'iframe', 'embed', 'object', 'a', 'handler', 'listener',
  'animate', 'set', 'animatetransform', 'animatemotion', 'animatecolor',
  'audio', 'video', 'frame', 'frameset', 'applet', 'base', 'link', 'meta', 'portal',
]);

/** Checked after decoding and removing whitespace/control characters. */
const SCRIPT_SCHEMES = ['javascript:', 'vbscript:', 'livescript:', 'data:text'] as const;

/** The only link targets: a same-file fragment or an embedded raster image. */
const EMBEDDED_IMAGE = /^data:image\/(?:png|jpeg|gif|webp);base64,[a-z0-9+/]*={0,2}$/;

/** CSS that can load or run something. `url(` is checked separately (only `#` is allowed). */
const CSS_FORBIDDEN =
  /@import|expression\s*\(|-moz-binding|behaviou?r\s*:|image-set\s*\(|(?:^|[^a-z0-9_-])(?:image|src|cross-fade)\s*\(/;

const XML_ENTITIES: ReadonlyMap<string, string> = new Map([
  ['amp', '&'],
  ['lt', '<'],
  ['gt', '>'],
  ['quot', '"'],
  ['apos', "'"],
]);

/** XML name, optionally prefixed (`xlink:href`). ASCII only — every real exporter is. */
const NAME = /[A-Za-z_][A-Za-z0-9._-]*(?::[A-Za-z_][A-Za-z0-9._-]*)?/y;

/** Inkscape, the most prolific, declares seven. */
const MAX_NAMESPACE_DECLARATIONS = 64;

const VIEWBOX_NUMBER = /^[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?$/;

/** Thrown inside the tokenizer to stop at the first problem; never escapes this module. */
class Rejected extends Error {
  constructor(readonly reason: string) {
    super(reason);
  }
}

function reject(reason: string): never {
  throw new Rejected(reason);
}

function inspectSvg(bytes: Uint8Array): LogoInspection {
  if (bytes[0] === 0x1f && bytes[1] === 0x8b) return { ok: false, reason: REASONS.svgz };
  let text: string;
  try {
    // fatal: a byte sequence that isn't UTF-8 is refused, not replaced — a
    // lenient decode would let our view of the file differ from the browser's.
    text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    return { ok: false, reason: REASONS.utf8 };
  }
  try {
    const { width, height } = screenSvg(text);
    return { ok: true, width, height, ext: 'svg' };
  } catch (err: unknown) {
    if (err instanceof Rejected) return { ok: false, reason: err.reason };
    throw err;
  }
}

interface OpenElement {
  qname: string;
  /** In-scope prefix → namespace URI ('' = default namespace). */
  scope: ReadonlyMap<string, string>;
  isStyle: boolean;
  css: string;
}

interface Attr {
  name: string;
  /** Character references already decoded — what the browser would see. */
  value: string;
}

function isSpace(c: string | undefined): boolean {
  return c === ' ' || c === '\t' || c === '\n' || c === '\r';
}

function skipSpace(text: string, at: number): number {
  let i = at;
  while (isSpace(text[i])) i++;
  return i;
}

function readName(text: string, at: number): string | null {
  NAME.lastIndex = at;
  const m = NAME.exec(text);
  return m ? m[0] : null;
}

function splitName(qname: string): [prefix: string, local: string] {
  const colon = qname.indexOf(':');
  return colon === -1 ? ['', qname] : [qname.slice(0, colon), qname.slice(colon + 1)];
}

function codePointToString(cp: number): string {
  if (!(cp > 0 && cp <= 0x10ffff) || (cp >= 0xd800 && cp <= 0xdfff)) return '\uFFFD';
  return String.fromCodePoint(cp);
}

/**
 * XML character references → characters, so `&#106;avascript:` is checked
 * as `javascript:`. The `;` is optional here (stricter than XML): a missing
 * one must not hide a reference from the checks. Decoded once, as XML does.
 */
function decodeRefs(s: string): string {
  if (!s.includes('&')) return s;
  return s.replace(
    /&(#[xX][0-9a-fA-F]+|#[0-9]+|[A-Za-z_][A-Za-z0-9._-]*);?/g,
    (_m: string, ref: string) => {
      if (ref[0] === '#') {
        const hex = ref[1] === 'x' || ref[1] === 'X';
        return codePointToString(parseInt(ref.slice(hex ? 2 : 1), hex ? 16 : 10));
      }
      const named = XML_ENTITIES.get(ref);
      // Without a DTD (refused) only the five XML entities exist.
      return named ?? reject(REASONS.entity);
    },
  );
}

/** C0 controls other than tab/LF/CR are not XML; neither are U+FFFE/U+FFFF. */
function checkChars(text: string): void {
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    if ((c < 0x20 && c !== 0x09 && c !== 0x0a && c !== 0x0d) || c === 0xfffe || c === 0xffff) {
      reject(REASONS.chars);
    }
  }
}

/**
 * What a URL parser would see: browsers drop whitespace and control
 * characters inside a scheme, so `java\tscript:` must match `javascript:`.
 */
function compact(value: string): string {
  let out = '';
  for (let i = 0; i < value.length; i++) {
    const c = value.charCodeAt(i);
    if (c <= 0x20 || (c >= 0x7f && c <= 0x9f)) continue;
    out += value[i];
  }
  return out.toLowerCase();
}

/** Drops CSS comments with indexOf, not a lazy regex — linear on hostile input. */
function stripCssComments(css: string): string {
  let out = '';
  let i = 0;
  for (;;) {
    const open = css.indexOf('/*', i);
    if (open === -1) return out + css.slice(i);
    out += css.slice(i, open);
    const close = css.indexOf('*/', open + 2);
    if (close === -1) return out;
    i = close + 2;
  }
}

/** CSS escapes → characters, so `@\69mport` and `u\72l(` are seen for what they are. */
function decodeCssEscapes(css: string): string {
  if (!css.includes('\\')) return css;
  return css.replace(
    /\\(?:([0-9a-fA-F]{1,6})[ \t\r\n\f]?|([\s\S]))/g,
    (_m: string, hex: string | undefined, ch: string | undefined) =>
      hex ? codePointToString(parseInt(hex, 16)) : ch === '\n' ? '' : (ch ?? ''),
  );
}

/**
 * Styles may only point inside the file: `url(#gradient)` is how every
 * exporter fills with a gradient; any other url(), @import or legacy
 * script hook is refused.
 *
 * CSS comments, strings and escapes can hide a url() from a simple scan
 * (`"/*"` inside a string, `\/*`, a CRLF after a hex escape), and no
 * exporter writes an escape into a logo's CSS, so a backslash is refused
 * outright. The checks then run on both the raw text and the text without
 * comments, so a comment can neither hide a load nor split one.
 *
 * `stylesheet` covers <style>, style="" and unprefixed presentation
 * attributes (fill, mask, cursor… are CSS values the browser parses).
 * `value` is the url() check alone, for prefixed editor metadata such as
 * `sodipodi:docname="logo image (1).svg"`, which is free text.
 */
function checkCss(css: string, kind: 'stylesheet' | 'value'): void {
  if (!css) return;
  if (kind === 'stylesheet' && css.includes('\\')) reject(REASONS.css);
  const raw = css.toLowerCase();
  const views = kind === 'stylesheet' ? [raw, stripCssComments(raw)] : [decodeCssEscapes(raw)];
  for (const s of views) {
    if (kind === 'stylesheet') {
      if (s.includes(XHTML_NS)) reject(REASONS.html);
      if (CSS_FORBIDDEN.test(s)) reject(REASONS.css);
    }
    const url = /url\s*\(\s*["']?\s*/g;
    for (let m = url.exec(s); m; m = url.exec(s)) {
      if (s[m.index + m[0].length] !== '#') reject(REASONS.css);
    }
  }
}

/** Attributes that name things rather than style them; never parsed as CSS. */
function isNameAttr(local: string): boolean {
  return local === 'id' || local === 'class' || local.startsWith('data-');
}

function checkAttr(attr: Attr): void {
  const [prefix, rawLocal] = splitName(attr.name);
  const local = rawLocal.toLowerCase();
  if (local.startsWith('on')) reject(REASONS.handler);
  const v = compact(attr.value);
  if (v.includes(XHTML_NS)) reject(REASONS.html);
  if (SCRIPT_SCHEMES.some((scheme) => v.includes(scheme))) reject(REASONS.scriptLink);
  if (local === 'href' && v !== '' && !v.startsWith('#') && !EMBEDDED_IMAGE.test(v)) {
    reject(REASONS.link);
  }
  // Unprefixed attributes may be presentation attributes — CSS values
  // such as mask="image-set(…)" — so they get the full stylesheet check.
  const css = local === 'style' || (prefix === '' && local !== 'href' && !isNameAttr(local));
  checkCss(attr.value, css ? 'stylesheet' : 'value');
}

function checkShape(width: number, height: number): void {
  const aspect = width / height;
  if (!Number.isFinite(aspect) || aspect > MAX_LOGO_ASPECT || aspect < 1 / MAX_LOGO_ASPECT) {
    reject(REASONS.shape);
  }
}

function readViewBox(attrs: readonly Attr[]): { width: number; height: number } {
  const viewBox = attrs.find((a) => a.name === 'viewBox');
  if (!viewBox) reject(REASONS.noViewBox);
  const parts = viewBox.value.trim().split(/[\s,]+/);
  if (parts.length !== 4 || !parts.every((p) => VIEWBOX_NUMBER.test(p))) {
    reject(REASONS.badViewBox);
  }
  const nums = parts.map(Number);
  const [, , width, height] = nums;
  if (!nums.every(Number.isFinite) || !(width > 0) || !(height > 0)) reject(REASONS.badViewBox);
  if (width > MAX_VIEWBOX_SIDE || height > MAX_VIEWBOX_SIDE) reject(REASONS.badViewBox);
  checkShape(width, height);
  return { width, height };
}

/** Walks the document once; returns the viewBox size or throws `Rejected`. */
function screenSvg(text: string): { width: number; height: number } {
  checkChars(text);
  if (text.toLowerCase().includes(XHTML_NS)) reject(REASONS.html);

  let pos = 0;
  // The XML declaration may only open the file; an encoding other than
  // UTF-8 would make the browser read different characters than we did.
  if (text.startsWith('<?xml') && isSpace(text[5])) {
    const end = text.indexOf('?>', 5);
    if (end === -1) reject(REASONS.malformed);
    const encoding = /encoding\s*=\s*["']([^"']*)["']/.exec(text.slice(5, end));
    if (encoding && !/^utf-?8$/i.test(encoding[1].trim())) reject(REASONS.utf8);
    pos = end + 2;
  }

  const rootScope: ReadonlyMap<string, string> = new Map([['xml', XML_NS]]);
  const stack: OpenElement[] = [];
  let size: { width: number; height: number } | null = null;
  let rootClosed = false;
  let namespaceCount = 0;

  while (pos < text.length) {
    const lt = text.indexOf('<', pos);
    const textEnd = lt === -1 ? text.length : lt;
    if (textEnd > pos) {
      const chunk = text.slice(pos, textEnd);
      const top = stack[stack.length - 1];
      if (!top) {
        if (chunk.trim() !== '') reject(REASONS.malformed);
      } else {
        const decoded = decodeRefs(chunk);
        if (top.isStyle) top.css += decoded;
      }
    }
    if (lt === -1) break;
    pos = lt;

    if (text.startsWith('<!--', pos)) {
      const end = text.indexOf('-->', pos + 4);
      if (end === -1) reject(REASONS.malformed);
      pos = end + 3;
      continue;
    }

    if (text.startsWith('<![CDATA[', pos)) {
      const end = text.indexOf(']]>', pos + 9);
      const top = stack[stack.length - 1];
      if (end === -1 || !top) reject(REASONS.malformed);
      if (top.isStyle) top.css += text.slice(pos + 9, end);
      pos = end + 3;
      continue;
    }

    // DOCTYPE, ENTITY, ELEMENT, ATTLIST: entities can smuggle any text past
    // every check below, so no declaration is accepted.
    if (text.startsWith('<!', pos)) reject(REASONS.doctype);

    if (text.startsWith('<?', pos)) {
      const end = text.indexOf('?>', pos + 2);
      if (end === -1) reject(REASONS.malformed);
      const target = (/^[^\s?]*/.exec(text.slice(pos + 2, end))?.[0] ?? '').toLowerCase();
      // xml-stylesheet is the one instruction browsers act on; any other
      // "xml…" target (a late XML declaration) is not well-formed. Editor
      // instructions such as <?xpacket?> are inert and allowed.
      if (target.startsWith('xml')) {
        reject(target === 'xml-stylesheet' ? REASONS.stylesheet : REASONS.malformed);
      }
      pos = end + 2;
      continue;
    }

    if (text.startsWith('</', pos)) {
      const name = readName(text, pos + 2);
      if (!name) reject(REASONS.malformed);
      const gt = skipSpace(text, pos + 2 + name.length);
      const top = stack.pop();
      if (text[gt] !== '>' || !top || top.qname !== name) reject(REASONS.malformed);
      if (top.isStyle) checkCss(top.css, 'stylesheet');
      if (stack.length === 0) rootClosed = true;
      pos = gt + 1;
      continue;
    }

    // Start tag.
    if (rootClosed) reject(REASONS.malformed);
    const qname = readName(text, pos + 1);
    if (!qname) reject(REASONS.malformed);
    let i = pos + 1 + qname.length;
    const attrs: Attr[] = [];
    const seen = new Set<string>();
    let selfClosing = false;
    for (;;) {
      const at = skipSpace(text, i);
      if (text.startsWith('/>', at)) {
        selfClosing = true;
        i = at + 2;
        break;
      }
      if (text[at] === '>') {
        i = at + 1;
        break;
      }
      // Attributes must be separated from the name and each other by whitespace.
      if (at === i) reject(REASONS.malformed);
      const name = readName(text, at);
      if (!name || seen.has(name)) reject(REASONS.malformed);
      seen.add(name);
      const eq = skipSpace(text, at + name.length);
      if (text[eq] !== '=') reject(REASONS.malformed);
      const open = skipSpace(text, eq + 1);
      const quote = text[open];
      if (quote !== '"' && quote !== "'") reject(REASONS.malformed);
      const close = text.indexOf(quote, open + 1);
      if (close === -1) reject(REASONS.malformed);
      const raw = text.slice(open + 1, close);
      if (raw.includes('<')) reject(REASONS.malformed);
      attrs.push({ name, value: decodeRefs(raw) });
      i = close + 1;
    }
    pos = i;

    const parent = stack[stack.length - 1];
    const isRoot = !parent;

    // Namespace declarations on this element.
    let scope = parent ? parent.scope : rootScope;
    let declarations: Map<string, string> | null = null;
    for (const attr of attrs) {
      const [prefix, local] = splitName(attr.name);
      const declared = attr.name === 'xmlns' ? '' : prefix === 'xmlns' ? local : null;
      if (declared === null) continue;
      const uri = attr.value.toLowerCase();
      if (uri.includes(XHTML_NS) || uri.includes(MATHML_NS)) reject(REASONS.html);
      // The default namespace is SVG everywhere: redeclaring it would turn
      // plain-looking elements into something the allowlist never sees.
      if (declared === '' && attr.value !== SVG_NS) {
        reject(isRoot ? REASONS.xmlns : REASONS.namespace);
      }
      if (declared === 'xml' || declared === 'xmlns') reject(REASONS.malformed);
      // Real exports declare a handful; thousands would only make each
      // scope copy below expensive.
      if (++namespaceCount > MAX_NAMESPACE_DECLARATIONS) reject(REASONS.malformed);
      declarations ??= new Map(scope);
      declarations.set(declared, attr.value);
    }
    if (declarations) scope = declarations;

    const [prefix, local] = splitName(qname);
    const ns = scope.get(prefix);
    if (isRoot) {
      if (prefix || local !== 'svg') reject(REASONS.notSvg);
      if (ns !== SVG_NS) reject(REASONS.xmlns);
      size = readViewBox(attrs);
    }
    if (ns === undefined) reject(prefix ? REASONS.malformed : REASONS.xmlns);
    if (FORBIDDEN_ELEMENTS.has(local.toLowerCase())) reject(elementReason(qname));
    // A stylesheet is text only; an element inside one is not a logo.
    if (parent?.isStyle) reject(elementReason(qname));
    // SVG elements come from the allowlist; elements in another namespace
    // (editor metadata) are never rendered, so only the name check applies.
    if (ns === SVG_NS && !SVG_ELEMENTS.has(local)) reject(elementReason(qname));

    for (const attr of attrs) {
      const [attrPrefix] = splitName(attr.name);
      if (attrPrefix && attrPrefix !== 'xmlns' && !scope.has(attrPrefix)) {
        reject(REASONS.malformed);
      }
      checkAttr(attr);
    }

    if (selfClosing) {
      if (isRoot) rootClosed = true;
    } else {
      stack.push({ qname, scope, isStyle: local.toLowerCase() === 'style', css: '' });
    }
  }

  if (stack.length > 0) reject(REASONS.malformed);
  if (!size) reject(REASONS.notSvg);
  return size;
}
