# Brand

The name, the mark and the wordmark are not covered by the code's AGPL
licence: see [TRADEMARKS.md](../TRADEMARKS.md).

The Echo & Aura identity: one mark, one wordmark, three colours. Everything
that draws them reads [src/lib/brand/marks.ts](../src/lib/brand/marks.ts), so
a change there reaches the site, the icons and the share image together.

## The mark

An **echo ampersand**: the curl is the "&" of the name, the arc around it is
the **echo**, and the marigold dot is the **aura**. The curl's two curves and
the arc share one centre, which is what makes the arc read as an echo.

| Cut                  | Use                                     | Shapes                        |
| -------------------- | --------------------------------------- | ----------------------------- |
| Full (`MARK`)        | 32 px and up: headers, cards, app icons | curl, arc, dot                |
| Small (`MARK_SMALL`) | under 32 px: favicons, tiny UI          | curl and dot, heavier strokes |

## The wordmark

`echo&aura`, lowercase, in **Archivo Bold** (the site's heading font, SIL OFL)
with the site's -0.02em tracking and the ampersand in marigold. It is stored as
**outlines**, not text, so icons, images and emails never depend on the font.

**The lockup** puts the full mark left of the wordmark: the mark 1.8× the
wordmark's height, centred on it, with a gap of 0.54× that height.

## Colours

| Name     | Hex       | Role                                                              |
| -------- | --------- | ----------------------------------------------------------------- |
| Charcoal | `#1C1A17` | Ink on paper; the background for dark uses                        |
| Paper    | `#FBFAF8` | Background; ink on charcoal                                       |
| Marigold | `#EDA43C` | The dot and the ampersand only, or the whole mark on the app icon |

One-colour versions (charcoal, paper or marigold throughout) are allowed for
single-ink uses such as prints; `mono` on the components draws them.

## In code

- **Web:** `BrandLogo` (lockup) and `BrandMark` (`small` for the cut) in
  [src/components/brand.tsx](../src/components/brand.tsx). The ink follows
  `currentColor`; size them by height (`h-6 w-auto`). Decorative by default:
  give `title` where the logo is the only label.
- **App icon** (`/icon` 512 px, `/apple-icon` 180 px): the full mark, all
  marigold, on full-bleed charcoal at 66% of the square, inside the maskable
  safe zone, so the manifest lists it for both `any` and `maskable`.
- **Favicon** (`src/app/favicon.ico`, 16/32/48 px): the small cut on a rounded
  charcoal tile.
- **Share image** (`opengraph-image`): the lockup in paper and marigold on
  charcoal.
- **Email header** (`public/brand/email-logo.png`, `EMAIL_LOGO`): the lockup
  on white, shown 28 px high and drawn at 3x. A hosted PNG because mail apps
  drop SVG; white, not transparent, so dark-mode apps never put charcoal on
  charcoal. Its alt text, `echoandaura`, is what shows with images blocked.
  Gmail caches images by URL: if the logo changes, give the file a new name.
- **Ticket PDF**: the lockup in black, as vector paths, top right. The ticket
  is black on white so it prints the same everywhere.
- **Developer docs site**: the same favicon (`docs-site/app/icon.svg`) and
  the lockup in the nav (`docs-site/components/brand-logo.tsx`). The docs
  site is its own package, so it reads a generated copy of the brand data
  (`docs-site/lib/brand.generated.ts`).

**After changing the mark or the wordmark**, run `pnpm brand:assets`. It
rewrites the favicon, the email PNG and the docs site's icon and data copy.
`tests/unit/brand.test.ts` fails while any of them is stale.

## Don't

- Stretch, rotate, outline or add effects (shadows, gradients, glows).
- Recolour beyond the three colours, or use marigold for anything but the dot,
  the ampersand or the all-marigold icon.
- Use the full mark under 32 px; use the small cut.
- Set the wordmark in live text in place of the outlines.

## Regenerating the wordmark outlines

Only needed if the font, weight or tracking changes. Download Archivo Bold
(Google Fonts), then with `opentype.js` lay out `echo`, `&` and `aura` at 100
units per em with kerning and `-0.02 × 100` tracking, and write each part's
`toPathData(2)` into `WORDMARK` in `marks.ts`, keeping the ampersand as its own
part with role `accent`. Update its `viewBox` to the union of the parts'
bounding boxes; `LOCKUP` is derived from it. Then run `pnpm brand:assets`.
