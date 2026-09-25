import { describe, expect, it } from 'vitest';
import { SPONSOR_LOGO_MAX_BYTES, SPONSOR_LOGO_TYPES, inspectLogo } from '@/server/lib/sponsor-logo';
import { isSponsorLogoKeyFor, sponsorLogoKey } from '@/server/lib/sponsor-logo-key';

/**
 * Plan decision 2: the logo screen. Real exports from the three tools
 * organizers actually use must pass untouched; everything that could run,
 * load or hide something must be refused with a sentence the admin can act on.
 */

const SVG = 'image/svg+xml';
const PNG = 'image/png';
const utf8 = (s: string) => new TextEncoder().encode(s);
const svg = (s: string) => inspectLogo(utf8(s), SVG);

/** Minimal valid-looking SVG wrapper for the rejection cases. */
const wrap = (body: string, rootAttrs = '') =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 40"${rootAttrs}>${body}</svg>`;

// A 1×1 PNG, as exporters embed raster fills.
const PIXEL =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';

// Illustrator 2024, File → Export As → SVG (internal CSS, embedded image).
const ILLUSTRATOR_EXPORT = `<?xml version="1.0" encoding="UTF-8"?>
<svg id="Layer_1" data-name="Layer 1" xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" viewBox="0 0 612 144">
  <defs>
    <style>
      .cls-1 {
        fill: #1c1a17;
      }

      .cls-2 {
        fill: url(#linear-gradient);
      }

      .cls-3 {
        font-family: Archivo-Bold, Archivo;
        font-size: 72px;
        font-weight: 700;
      }
    </style>
    <linearGradient id="linear-gradient" x1="0" y1="72" x2="144" y2="72" gradientUnits="userSpaceOnUse">
      <stop offset="0" stop-color="#eda43c"/>
      <stop offset="1" stop-color="#e2962c"/>
    </linearGradient>
  </defs>
  <path class="cls-2" d="M72,0C32.24,0,0,32.24,0,72s32.24,72,72,72,72-32.24,72-72S111.76,0,72,0Z"/>
  <text class="cls-3" transform="translate(172.8 98.4)"><tspan x="0" y="0">Kolorob</tspan></text>
  <rect class="cls-1" x="520" y="40" width="20" height="64"/>
  <image width="40" height="40" transform="translate(560 52)" xlink:href="${PIXEL}"/>
</svg>
`;

// Illustrator, File → Save As → SVG (the older plug-in: comment, xml:space, CDATA-free style).
const ILLUSTRATOR_SAVE_AS = `<?xml version="1.0" encoding="utf-8"?>
<!-- Generator: Adobe Illustrator 27.0.0, SVG Export Plug-In . SVG Version: 6.00 Build 0)  -->
<svg version="1.1" id="Layer_1" xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" x="0px" y="0px"
\t viewBox="0 0 300 100" style="enable-background:new 0 0 300 100;" xml:space="preserve">
<style type="text/css">
\t.st0{fill:#1C1A17;}
\t.st1{fill:url(#SVGID_1_);}
</style>
<g>
\t<linearGradient id="SVGID_1_" gradientUnits="userSpaceOnUse" x1="0" y1="50" x2="100" y2="50">
\t\t<stop  offset="0" style="stop-color:#EDA43C"/>
\t\t<stop  offset="1" style="stop-color:#E2962C"/>
\t</linearGradient>
\t<circle class="st1" cx="50" cy="50" r="50"/>
\t<rect x="120" y="20" class="st0" width="160" height="60"/>
</g>
</svg>
`;

// Inkscape 1.3, plain "Inkscape SVG" save: editor namespaces, namedview, RDF metadata.
const INKSCAPE = `<?xml version="1.0" encoding="UTF-8" standalone="no"?>
<!-- Created with Inkscape (http://www.inkscape.org/) -->

<svg
   width="120mm"
   height="40mm"
   viewBox="0 0 120 40"
   version="1.1"
   id="svg1"
   inkscape:version="1.3.2 (091e20e, 2023-11-25)"
   sodipodi:docname="logo image (1).svg"
   inkscape:export-filename="logo.png"
   inkscape:export-xdpi="96"
   inkscape:export-ydpi="96"
   xmlns:inkscape="http://www.inkscape.org/namespaces/inkscape"
   xmlns:sodipodi="http://sodipodi.sourceforge.net/DTD/sodipodi-0.dtd"
   xmlns="http://www.w3.org/2000/svg"
   xmlns:svg="http://www.w3.org/2000/svg"
   xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#"
   xmlns:cc="http://creativecommons.org/ns#"
   xmlns:dc="http://purl.org/dc/elements/1.1/">
  <sodipodi:namedview
     id="namedview1"
     pagecolor="#ffffff"
     bordercolor="#000000"
     borderopacity="0.25"
     inkscape:showpageshadow="2"
     inkscape:pageopacity="0.0"
     inkscape:pagecheckerboard="0"
     inkscape:deskcolor="#d1d1d1"
     inkscape:document-units="mm"
     inkscape:zoom="1.4"
     inkscape:current-layer="layer1">
    <inkscape:page
       x="0"
       y="0"
       width="120"
       height="40"
       id="page2"
       margin="0"
       bleed="0" />
  </sodipodi:namedview>
  <defs
     id="defs1">
    <inkscape:path-effect
       effect="spiro"
       id="path-effect1"
       is_visible="true"
       lpeversion="1" />
  </defs>
  <metadata
     id="metadata1">
    <rdf:RDF>
      <cc:Work
         rdf:about="">
        <dc:format>image/svg+xml</dc:format>
        <dc:type
           rdf:resource="http://purl.org/dc/dcmitype/StillImage" />
        <dc:title>Kolorob Audio &amp; Friends</dc:title>
        <cc:license
           rdf:resource="http://creativecommons.org/licenses/by-sa/4.0/" />
      </cc:Work>
    </rdf:RDF>
  </metadata>
  <g
     inkscape:label="Layer 1"
     inkscape:groupmode="layer"
     id="layer1">
    <path
       style="fill:#1c1a17;fill-opacity:1;stroke:none;stroke-width:0.264583"
       d="m 10,10 h 20 v 20 h -20 z"
       id="rect1"
       sodipodi:nodetypes="ccccc" />
    <path
       sodipodi:type="arc"
       style="fill:#eda43c;stroke-width:0.264583"
       id="path2"
       sodipodi:cx="50"
       sodipodi:cy="20"
       sodipodi:rx="10"
       sodipodi:ry="10"
       sodipodi:start="0"
       sodipodi:end="3.1415927"
       sodipodi:open="true"
       sodipodi:arc-type="arc"
       d="M 60,20 A 10,10 0 0 1 50,30 10,10 0 0 1 40,20" />
    <text
       xml:space="preserve"
       style="font-size:10.5833px;font-family:Archivo;-inkscape-font-specification:Archivo;fill:#1c1a17"
       x="70"
       y="24"
       id="text1"><tspan
         sodipodi:role="line"
         id="tspan1"
         x="70"
         y="24">Aura</tspan></text>
  </g>
</svg>
`;

// Figma, Export → SVG: no XML declaration, filters, clip paths, an image fill via <pattern>.
const FIGMA = `<svg width="240" height="80" viewBox="0 0 240 80" fill="none" xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink">
<g clip-path="url(#clip0_12_34)">
<g filter="url(#filter0_d_12_34)">
<path d="M20 20H60V60H20V20Z" fill="url(#paint0_linear_12_34)"/>
</g>
<path fill-rule="evenodd" clip-rule="evenodd" d="M80 30H220V50H80V30Z" fill="#1C1A17"/>
<rect x="224" y="24" width="12" height="12" fill="url(#pattern0_12_34)"/>
</g>
<defs>
<filter id="filter0_d_12_34" x="16" y="20" width="48" height="48" filterUnits="userSpaceOnUse" color-interpolation-filters="sRGB">
<feFlood flood-opacity="0" result="BackgroundImageFix"/>
<feColorMatrix in="SourceAlpha" type="matrix" values="0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 127 0" result="hardAlpha"/>
<feOffset dy="4"/>
<feGaussianBlur stdDeviation="2"/>
<feComposite in2="hardAlpha" operator="out"/>
<feColorMatrix type="matrix" values="0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0.25 0"/>
<feBlend mode="normal" in2="BackgroundImageFix" result="effect1_dropShadow_12_34"/>
<feBlend mode="normal" in="SourceGraphic" in2="effect1_dropShadow_12_34" result="shape"/>
</filter>
<pattern id="pattern0_12_34" patternContentUnits="objectBoundingBox" width="1" height="1">
<use xlink:href="#image0_12_34" transform="scale(0.01)"/>
</pattern>
<linearGradient id="paint0_linear_12_34" x1="20" y1="20" x2="60" y2="60" gradientUnits="userSpaceOnUse">
<stop stop-color="#EDA43C"/>
<stop offset="1" stop-color="#E2962C"/>
</linearGradient>
<clipPath id="clip0_12_34">
<rect width="240" height="80" fill="white"/>
</clipPath>
<image id="image0_12_34" width="100" height="100" xlink:href="${PIXEL}"/>
</defs>
</svg>
`;

/** A PNG's first bytes: signature, then a chunk (IHDR unless told otherwise). */
function pngHeader(width: number, height: number, { cgbi = false } = {}): Uint8Array {
  const chunk = (type: string, data: number[]) => {
    const out = new Uint8Array(12 + data.length);
    const view = new DataView(out.buffer);
    view.setUint32(0, data.length);
    out.set(
      [...type].map((c) => c.charCodeAt(0)),
      4,
    );
    out.set(data, 8);
    return out; // CRC left zero: the screen reads the header, not the checksum
  };
  const ihdr = new Uint8Array(13);
  const view = new DataView(ihdr.buffer);
  view.setUint32(0, width);
  view.setUint32(4, height);
  ihdr.set([8, 6, 0, 0, 0], 8); // 8-bit RGBA, deflate, no filter, no interlace
  const parts = [
    new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    ...(cgbi ? [chunk('CgBI', [0x50, 0x00, 0x20, 0x02])] : []),
    chunk('IHDR', [...ihdr]),
    chunk('IEND', []),
  ];
  const bytes = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of parts) {
    bytes.set(p, at);
    at += p.length;
  }
  return bytes;
}

function expectRejected(result: ReturnType<typeof inspectLogo>, reason: RegExp) {
  expect(result.ok).toBe(false);
  if (!result.ok) expect(result.reason).toMatch(reason);
}

describe('inspectLogo — accepted', () => {
  it('an Illustrator "Export As" SVG with internal CSS, a gradient and an embedded image', () => {
    expect(svg(ILLUSTRATOR_EXPORT)).toEqual({ ok: true, width: 612, height: 144, ext: 'svg' });
  });

  it('an Illustrator "Save As" SVG with the generator comment and xml:space', () => {
    expect(svg(ILLUSTRATOR_SAVE_AS)).toEqual({ ok: true, width: 300, height: 100, ext: 'svg' });
  });

  it('an Inkscape SVG with sodipodi/inkscape namespaces and RDF metadata', () => {
    expect(svg(INKSCAPE)).toEqual({ ok: true, width: 120, height: 40, ext: 'svg' });
  });

  it('a Figma SVG with filters, clip paths and an image pattern', () => {
    expect(svg(FIGMA)).toEqual({ ok: true, width: 240, height: 80, ext: 'svg' });
  });

  it('takes the shape from the viewBox, however it is written', () => {
    expect(svg(wrap('').replace('0 0 100 40', '0,0,123.5,40.25'))).toMatchObject({
      ok: true,
      width: 123.5,
      height: 40.25,
    });
    expect(svg(wrap('').replace('0 0 100 40', '-10 -10 1e2 5E1'))).toMatchObject({
      width: 100,
      height: 50,
    });
  });

  it('accepts a UTF-8 BOM, a charset parameter and a self-closing root', () => {
    const bom = new Uint8Array([0xef, 0xbb, 0xbf, ...utf8(ILLUSTRATOR_EXPORT)]);
    expect(inspectLogo(bom, SVG).ok).toBe(true);
    expect(inspectLogo(utf8(FIGMA), 'image/svg+xml; charset=utf-8').ok).toBe(true);
    expect(svg('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"/>')).toMatchObject({
      ok: true,
      width: 10,
      height: 10,
    });
  });

  it('reads a PNG header: width and height from IHDR', () => {
    expect(inspectLogo(pngHeader(640, 160), PNG)).toEqual({
      ok: true,
      width: 640,
      height: 160,
      ext: 'png',
    });
    expect(inspectLogo(pngHeader(256, 4096), PNG).ok).toBe(true);
  });
});

describe('inspectLogo — rejected', () => {
  it('an XHTML-namespaced script under a custom prefix', () => {
    expectRejected(
      svg(wrap('<zz:script xmlns:zz="http://www.w3.org/1999/xhtml">alert(1)</zz:script>')),
      /contains HTML/,
    );
    // The namespace spelled with a character reference is still XHTML.
    expectRejected(
      svg(wrap('<zz:div xmlns:zz="http://www.w3.org/1999/&#x78;html">hi</zz:div>')),
      /contains HTML/,
    );
    // A script under any prefix, bound to anything, is refused by name.
    expectRejected(svg(wrap('<q:script xmlns:q="urn:x">alert(1)</q:script>')), /<q:script>/);
    expectRejected(svg(wrap('<script>alert(1)</script>')), /<script>/);
    expectRejected(svg(wrap('<Script>alert(1)</Script>')), /<Script>/);
  });

  it('a javascript: link hidden behind character references', () => {
    for (const href of [
      '&#106;avascript:alert(1)',
      '&#x6A;&#x61;vascript:alert(1)',
      '&#0000106avascript:alert(1)',
      'JaVaScRiPt:alert(1)',
    ]) {
      expectRejected(svg(wrap(`<use href="${href}"/>`)), /script link/);
    }
    expectRejected(
      svg(wrap('<image xlink:href="vbscript:x"/>', ' xmlns:xlink="http://www.w3.org/1999/xlink"')),
      /script link/,
    );
  });

  it('a javascript: link broken up with whitespace or control characters', () => {
    for (const href of [
      'java\tscript:alert(1)',
      'java&#9;script:alert(1)',
      ' \njavascript:x',
      'java&#x0A;script:x',
    ]) {
      expectRejected(svg(wrap(`<use href="${href}"/>`)), /script link/);
    }
    expectRejected(svg(wrap('<image href="data:text/html;base64,PHNjcmlwdD4="/>')), /script link/);
  });

  it('links to anything but a #fragment or an embedded raster image', () => {
    expectRejected(svg(wrap('<image href="https://evil.example/logo.png"/>')), /outside itself/);
    expectRejected(svg(wrap('<image href="logo.png"/>')), /outside itself/);
    expectRejected(
      svg(wrap('<image href="data:image/svg+xml;base64,PHN2Zz4="/>')),
      /outside itself/,
    );
    expectRejected(svg(wrap('<feImage href="//evil.example/x.png"/>')), /outside itself/);
  });

  it('<a>, animation, foreignObject and other active elements', () => {
    expectRejected(svg(wrap('<a href="#x"><rect width="1" height="1"/></a>')), /<a>/);
    expectRejected(
      svg(
        wrap('<use href="#x"><animate attributeName="href" values="javascript:alert(1)"/></use>'),
      ),
      /<animate>/,
    );
    expectRejected(svg(wrap('<set attributeName="href" to="#y"/>')), /<set>/);
    expectRejected(
      svg(wrap('<animateTransform attributeName="transform"/>')),
      /<animateTransform>/,
    );
    expectRejected(svg(wrap('<foreignObject width="10" height="10"/>')), /<foreignObject>/);
    expectRejected(svg(wrap('<iframe/>')), /<iframe>/);
    // SVG elements outside the allowlist, even harmless-sounding ones.
    expectRejected(svg(wrap('<cursor href="#c"/>')), /<cursor>/);
    // A stylesheet is text only.
    expectRejected(svg(wrap('<style><g/></style>')), /<g>/);
  });

  it('on* event handlers anywhere', () => {
    expectRejected(svg(wrap('<rect onclick="alert(1)"/>')), /event handlers/);
    expectRejected(svg(wrap('', ' onload="alert(1)"')), /event handlers/);
    expectRejected(svg(wrap('<rect x:ONmouseover="x" xmlns:x="urn:x"/>')), /event handlers/);
  });

  it('DOCTYPE and ENTITY declarations, and undefined entities', () => {
    expectRejected(
      svg(`<!DOCTYPE svg [<!ENTITY x "javascript:alert(1)">]>${wrap('<use href="&x;"/>')}`),
      /DOCTYPE or entity/,
    );
    expectRejected(
      svg(
        `<!DOCTYPE svg PUBLIC "-//W3C//DTD SVG 1.1//EN" "http://www.w3.org/Graphics/SVG/1.1/DTD/svg11.dtd">${wrap('')}`,
      ),
      /DOCTYPE or entity/,
    );
    expectRejected(svg(wrap('<title>&nbsp;</title>')), /entity that is not defined/);
  });

  it('an xml-stylesheet processing instruction', () => {
    expectRejected(
      svg(`<?xml version="1.0"?><?xml-stylesheet href="https://evil.example/x.css"?>${wrap('')}`),
      /links a stylesheet/,
    );
  });

  it('@import or an external url( in a stylesheet or style attribute', () => {
    expectRejected(
      svg(wrap('<style>@import url(https://evil.example/x.css);</style>')),
      /styles load/,
    );
    expectRejected(svg(wrap('<style>@\\69mport "x.css";</style>')), /styles load/);
    expectRejected(
      svg(wrap('<style><![CDATA[.a{fill:url(https://evil.example/x.svg#g)}]]></style>')),
      /styles load/,
    );
    expectRejected(svg(wrap('<style>.a{fill:u\\72l( "//evil.example/x")}</style>')), /styles load/);
    expectRejected(
      svg(wrap('<rect style="fill:url(&quot;http://evil.example/x&quot;)"/>')),
      /styles load/,
    );
    expectRejected(svg(wrap('<rect style="behavior:url(#x)"/>')), /styles load/);
    expectRejected(svg(wrap('<rect style="-moz-binding:url(#x)"/>')), /styles load/);
    // Presentation attributes are CSS values too.
    expectRejected(svg(wrap('<rect fill="url(http://evil.example/x.svg#g)"/>')), /styles load/);
  });

  it('a missing or unusable viewBox, asking for a re-export', () => {
    expectRejected(
      svg('<svg xmlns="http://www.w3.org/2000/svg" width="100" height="40"></svg>'),
      /no viewBox.*Export it again with a viewBox/,
    );
    for (const vb of [
      '0 0 100',
      '0 0 0 40',
      '0 0 100 -1',
      '0 0 abc 40',
      '0 0 1e999 40',
      ',0 0 100 40',
    ]) {
      expectRejected(svg(wrap('').replace('0 0 100 40', vb)), /viewBox must be four numbers/);
    }
  });

  it('a root without the SVG namespace, or a namespace switch inside', () => {
    expectRejected(svg('<svg viewBox="0 0 10 10"></svg>'), /missing xmlns/);
    expectRejected(
      svg('<svg xmlns="http://www.w3.org/2000/svgx" viewBox="0 0 10 10"></svg>'),
      /missing xmlns/,
    );
    expectRejected(svg(wrap('<g xmlns="urn:other"><rect/></g>')), /another namespace/);
    expectRejected(
      svg('<html xmlns="http://www.w3.org/2000/svg"/>'),
      /does not start with an <svg>/,
    );
  });

  it('SVGZ, non-UTF-8 text and control characters', () => {
    expectRejected(inspectLogo(new Uint8Array([0x1f, 0x8b, 0x08, 0x00, 0x00]), SVG), /svgz/i);
    expectRejected(inspectLogo(new Uint8Array([0x3c, 0x73, 0xff, 0xfe, 0x3e]), SVG), /UTF-8/);
    expectRejected(svg(`<?xml version="1.0" encoding="ISO-8859-1"?>${wrap('')}`), /UTF-8/);
    expectRejected(svg(wrap('<title>a\u0000b</title>')), /characters that are not allowed/);
  });

  it('files that are not well-formed', () => {
    for (const bad of [
      wrap('<g>'),
      wrap('<g></rect>'),
      `${wrap('')}<svg/>`,
      `${wrap('')}trailing`,
      wrap('<rect x=1/>'),
      wrap('<rect x="1"y="2"/>'),
      wrap('<undeclared:thing/>'),
      wrap('<rect nope:x="1"/>'),
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"',
    ]) {
      expectRejected(svg(bad), /could not be read/);
    }
  });

  it('a CgBI (Apple-optimised) PNG', () => {
    expectRejected(inspectLogo(pngHeader(64, 64, { cgbi: true }), PNG), /Apple-only/);
  });

  it('a PNG outside 16–4096 px per side', () => {
    expectRejected(inspectLogo(pngHeader(20000, 200), PNG), /16 to 4096 pixels/);
    expectRejected(inspectLogo(pngHeader(200, 20000), PNG), /16 to 4096 pixels/);
    expectRejected(inspectLogo(pngHeader(8, 8), PNG), /16 to 4096 pixels/);
  });

  it('bytes that are not a PNG, or a truncated header', () => {
    expectRejected(inspectLogo(utf8(FIGMA), PNG), /could not be read/);
    expectRejected(inspectLogo(pngHeader(64, 64).slice(0, 20), PNG), /could not be read/);
  });

  it('an empty or oversize file', () => {
    expectRejected(inspectLogo(new Uint8Array(0), SVG), /empty/);
    const big = new Uint8Array(SPONSOR_LOGO_MAX_BYTES + 1);
    big.set(pngHeader(64, 64));
    expectRejected(inspectLogo(big, PNG), /512 KB/);
    // Exactly at the limit is fine.
    const atLimit = new Uint8Array(SPONSOR_LOGO_MAX_BYTES);
    atLimit.set(pngHeader(64, 64));
    expect(inspectLogo(atLimit, PNG).ok).toBe(true);
  });

  it('CSS that hides a load behind comments, strings or escapes (review payloads)', () => {
    const CR_LF = '\r\n';
    for (const body of [
      '<style>svg{--a:"/*";background-image:url(https://evil.example/str.png);--b:"*/"}</style>',
      '<style>\\/*{} svg{background-image:url(https://evil.example/esc.png)} */</style>',
      '<style>@charset "/*"; @import "https://evil.example/imp.css"; @charset "*/";</style>',
      '<style>svg{background-image:\\75&#13;&#10;rl(https://evil.example/crlfref.png)}</style>',
      `<style>svg{background-image:\\75${CR_LF}rl(https://evil.example/crlf.png)}</style>`,
      `<style>@\\69${CR_LF}mport "https://evil.example/imp2.css";</style>`,
      '<rect style="--a:&quot;/*&quot;;mask-image:url(https://evil.example/attr.png);--b:&quot;*/&quot;"/>',
      '<rect style="mask-image:\\75&#13;&#10;rl(https://evil.example/attrcrlf.png)"/>',
      '<style>@font-face{font-family:x;src:"/*";src:url(https://evil.example/f2.woff);--x:"*/"}text{font-family:x}</style>',
    ]) {
      expectRejected(svg(wrap(body)), /styles load something/);
    }
  });

  it('image loads in presentation attributes (mask, cursor)', () => {
    for (const attr of [
      'mask="image-set(&quot;https://evil.example/pres.png&quot; 1x)"',
      'cursor="image-set(&quot;https://evil.example/cur.png&quot; 1x), auto"',
      'mask="image(&quot;https://x/y.png&quot;)"',
      'fill="url(https://evil.example/p.svg#g)"',
    ]) {
      expectRejected(svg(wrap(`<rect width="5" height="5" ${attr}/>`)), /styles load something/);
    }
    // Names are not CSS: Illustrator layer names and editor metadata stay free text.
    expect(svg(wrap('<g id="image (2)" data-name="Image (2)"/>')).ok).toBe(true);
    expect(
      svg(
        wrap(
          '<g/>',
          ' xmlns:sodipodi="http://sodipodi.sourceforge.net/DTD/sodipodi-0.dtd" sodipodi:docname="logo image (1).svg"',
        ),
      ).ok,
    ).toBe(true);
  });

  it('a shape too wide or too tall to draw (overflowing or absurd viewBox)', () => {
    for (const vb of ['0 0 1e308 0.5', '0 0 1 1e-320', '0 0 1000 1', '0 0 1 21', '0 0 2e6 1e6']) {
      const r = svg(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="${vb}"/>`);
      expect(r.ok, vb).toBe(false);
    }
    expect(svg('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 700 100"/>').ok).toBe(true);
    expectRejected(inspectLogo(pngHeader(4000, 100), PNG), /at most 20 times/);
    expect(inspectLogo(pngHeader(2000, 100), PNG).ok).toBe(true);
  });

  it('any other file type', () => {
    for (const type of ['image/jpeg', 'image/webp', 'image/gif', 'text/html', 'text/xml', '']) {
      expectRejected(inspectLogo(pngHeader(64, 64), type), /SVG or PNG/);
    }
  });

  it('SPONSOR_LOGO_TYPES maps each accepted type to its stored extension', () => {
    expect(SPONSOR_LOGO_TYPES).toEqual({ 'image/svg+xml': 'svg', 'image/png': 'png' });
  });
});

describe('sponsorLogoKey / isSponsorLogoKeyFor', () => {
  const SPONSOR = '11111111-1111-4111-8111-111111111111';
  const OTHER = '22222222-2222-4222-8222-222222222222';

  it('issues keys under the sponsor prefix, unique per call', () => {
    const a = sponsorLogoKey(SPONSOR, 'svg');
    const b = sponsorLogoKey(SPONSOR, 'svg');
    expect(a).toMatch(new RegExp(`^sponsors/${SPONSOR}/logo-[A-Za-z0-9_-]{12}\\.svg$`));
    expect(a).not.toBe(b);
    expect(sponsorLogoKey(SPONSOR, 'png')).toMatch(/\.png$/);
    expect(isSponsorLogoKeyFor(a, SPONSOR)).toBe(true);
  });

  it('refuses an id that is not a UUID (it becomes a path segment)', () => {
    expect(() => sponsorLogoKey('../events', 'svg')).toThrow(RangeError);
    expect(() => sponsorLogoKey('', 'png')).toThrow(RangeError);
  });

  it('rejects keys for other sponsors, traversal and foreign shapes', () => {
    const good = sponsorLogoKey(SPONSOR, 'png');
    expect(isSponsorLogoKeyFor(good, OTHER)).toBe(false);
    expect(
      isSponsorLogoKeyFor(`sponsors/${SPONSOR}/../${OTHER}/logo-abcdefghijkl.png`, SPONSOR),
    ).toBe(false);
    expect(isSponsorLogoKeyFor(`sponsors/${SPONSOR}/logo-abcdefghijkl.jpg`, SPONSOR)).toBe(false);
    expect(isSponsorLogoKeyFor(`sponsors/${SPONSOR}/cover-abcdefghijkl.png`, SPONSOR)).toBe(false);
    expect(isSponsorLogoKeyFor(`events/${SPONSOR}/logo-abcdefghijkl.png`, SPONSOR)).toBe(false);
    expect(isSponsorLogoKeyFor('', SPONSOR)).toBe(false);
    expect(isSponsorLogoKeyFor('sponsors//logo-abcdefghijkl.png', '')).toBe(false);
  });
});
