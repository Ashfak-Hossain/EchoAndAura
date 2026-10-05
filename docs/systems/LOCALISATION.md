# Localisation: Bangla, and 12-hour time

Status: PROPOSED · Owner: Evan · Last updated: 2026-10-04

The public site, the buyer's emails and the ticket PDF in Bangla as well as
English, and every time a person reads in 12-hour form ("7:30 PM",
"সন্ধ্যা ৭:৩০"). Decided with the owner on 2026-10-04: English stays at
`/`, Bangla lives at `/bn`; 12-hour time everywhere people read. Each slice
below gets its ADR when it is built.

---

## Goals

- A buyer who prefers Bangla can do everything in Bangla: find an event,
  register, pay, read every email, open the ticket.
- Nothing that works today breaks. Every English URL, shared link and
  Google result stays where it is, and English pages render exactly as
  before.
- No untranslated key ever reaches production: a missing Bangla string is a
  **type error at build time**, not a blank on the page.
- The server and the browser always print the same text: no hydration
  mismatches from the browser's own date or number formatting.
- Pages stay fast: the edge cache (ADR-056) keeps working for both
  languages.

## Out of scope

- **The admin area and the gate scanner stay in English.** Their vocabulary
  is operational, they have a few readers, and they double the number of
  strings. They do get 12-hour time.
- Machine output stays as it is: CSV exports (24-hour, so spreadsheets
  sort), structured data and sitemaps (ISO 8601).
- No automatic language guessing from the browser (see "Choosing the
  language").

---

## 1. 12-hour time (first, on its own)

All human-facing times already go through five functions in
`src/lib/time.ts`, used in 43 files. They change format; their callers
do not.

| Function           | Today                   | After                     |
| ------------------ | ----------------------- | ------------------------- |
| `formatDhaka`      | `1 Oct 2026, 19:00`     | `1 Oct 2026, 7:00 PM`     |
| `formatDhakaLong`  | `Thu 1 Oct 2026, 19:00` | `Thu 1 Oct 2026, 7:00 PM` |
| `formatDhakaShort` | `Thu 1 Oct, 19:00`      | `Thu 1 Oct, 7:00 PM`      |
| `formatDhakaClock` | `20:51`                 | `8:51 PM`                 |
| `formatRelative`   | unchanged (no clock)    | unchanged                 |

- Format: hour without a leading zero, minutes always, a space, `AM`/`PM`
  in capitals. Noon is `12:00 PM`, midnight `12:00 AM`; both are pinned in
  unit tests because that is where 12-hour clocks go wrong.
- The admin's `datetime-local` inputs are drawn by the phone or browser and
  follow the device's own setting; nothing to change there.
- CSV exports keep `yyyy-MM-dd HH:mm`.

The same slice also fixes a bug found while designing this: **a buyer
typing on a Bangla keyboard cannot enter their bKash number.** `০১৭১২…` fails
the `^1[3-9]\d{8}$` check. A single `normaliseDigits()` (Bangla `০-৯` and
Arabic-Indic digits to ASCII) runs before every numeric validation: phone,
trxID, quantity, promo code. The trxID keeps its existing normalisation
(Invariant 3) after that.

## 2. URLs and routing

```
/                    English home          /bn                  Bangla home
/events/<slug>       English event         /bn/events/<slug>    Bangla event
/admin, /door, /api  English only, no /bn version
```

- **`next-intl` 4** (supports Next 16; checked 2026-10-04) with
  `localePrefix: 'as-needed'`: English has no prefix, Bangla has `/bn`.
  `localeDetection: false`, so the library never redirects on its own.
- The public tree moves to `src/app/[locale]/(public)/…`. Admin and door
  keep English root layouts of their own (multiple root layouts; moving
  between public and admin was already a full page load).
- `<html lang="bn">` on Bangla pages, `lang="en"` on English ones.
- `src/proxy.ts` gains the locale step **before** its CSP step, so the
  nonce header lands on whatever response the locale step produces
  (a rewrite or a redirect). Admin, door and API skip the locale step.
- A switch to turn it on: `PUBLIC_LOCALES=en` (default) or `en,bn`. With
  Bangla off, `/bn/*` is a 404 and the switch is hidden, so slices can ship
  while translations are still under review.

## 3. Choosing the language

- **A visible switch on every public page** (`English | বাংলা`) that keeps
  you on the same page in the other language.
- **The choice is remembered** in a cookie `ea_lang` (one year, `HttpOnly`: a
  server action sets it and only the proxy reads it). When someone
  who chose Bangla opens an English link, the proxy redirects them once to
  the `/bn` version of the same page.
- That redirect must reach the server, so the edge cache rule is bypassed
  for exactly that case: English path **and** `ea_lang=bn`. Everyone else
  gets the cached page as now. Rule change, in `CLOUDFLARE.md` § Cache
  rules:

  ```
  … and not (http.cookie contains "ea_lang=bn" and not starts_with(http.request.uri.path, "/bn"))
  … path list gains "/bn" and the /bn/ forms of every cached page
  ```

- **No guessing from `Accept-Language`.** The cache key ignores that
  header, so a redirect based on it would be cached and served to the
  wrong people. It also surprises people: many Bangladeshi phones are set
  to English. The switch is the one way in.

## 4. Translation catalogue

- Messages live in `src/messages/en.ts` and `src/messages/bn.ts` as
  TypeScript objects. `bn` is typed `satisfies Messages` (the shape of
  `en`), so **a missing or misspelt key fails `pnpm typecheck`**. A unit
  test also fails on keys present in `bn` but unused in `en`.
- ICU message syntax for plurals and variables (`{count, plural, one {…}
other {…}}`). Bangla has two plural forms, the same as English.
- Server components use `getTranslations`, client components
  `useTranslations`. Code in `src/server/` (emails, PDF, worker) uses
  `createTranslator` from `use-intl/core`, which does not import
  `next/*`, so the architecture rule holds.
- Server actions return **error codes**, never sentences; the page turns
  the code into text in the visitor's language. Zod messages become codes
  the same way.
- Names, ticket codes, order references, trxIDs and amounts typed by people
  are never translated.

## 5. Numbers, money, dates and times in Bangla

`Intl` is not used for Bangla output. Node prints `৭:৩০ PM` (Bangla digits,
Latin "PM") or `৭:৩০ সন্ধ্যাবেলায়`, and phone browsers ship different ICU
data, so the server and the browser would disagree. The same reason
`formatBDT` already formats by hand. Instead, small pure functions with
tests:

| What  | English (unchanged rules) | Bangla                                    |
| ----- | ------------------------- | ----------------------------------------- |
| Money | `৳1,200.00`               | `৳১,২০০.০০`; lakh grouping `৳১,২৩,৪৫৬.০০` |
| Count | `12 left`                 | `১২টি বাকি`                               |
| Date  | `Sat 10 Oct 2026`         | `শনিবার, ১০ অক্টোবর ২০২৬`                 |
| Time  | `7:30 PM`                 | `সন্ধ্যা ৭:৩০`                            |

- Bangla time takes the time-of-day word people actually say: ভোর (4–6),
  সকাল (6–12), দুপুর (12–3 PM), বিকেল (3–6 PM), সন্ধ্যা (6–8 PM), রাত
  (8 PM–4 AM). The boundaries are pinned in unit tests; the list is
  for Raj to confirm.
- Gregorian month and weekday names in Bangla (অক্টোবর, শনিবার), not the
  Bangla calendar.
- Money formatting stays in `src/server/lib/money.ts` (Invariant 1):
  `formatBDT(paisa, locale)`. Times stay in `src/lib/time.ts`.
- **Things people copy or type elsewhere stay in Latin digits, even in
  Bangla:** the bKash number to send money to, the order reference, ticket
  codes, the trxID. A bKash app wants `01712…`, not `০১৭১২…`.

## 6. What the organizer enters (event content)

- New optional fields: `events.title_bn`, `events.description_bn`,
  `events.venue_bn`, `ticket_types.name_bn` (one migration).
- The admin event form gets a **বাংলা** tab with those fields and a
  preview. Empty means "use the English": each field falls back on its own,
  and fallback text is wrapped in `lang="en"` so screen readers switch
  voice.
- Sponsor names stay as entered.

## 7. Static and legal pages

- FAQ, about, contact, terms, privacy and refund get Bangla versions. Claude
  drafts them; **a native speaker (Raj) reviews every page** before the
  switch turns on. Machine-quality legal Bangla is worse than none.
- Terms, privacy and refund say that the English version prevails if the
  two differ.
- Each page keeps its own `LAST_UPDATED`; the Bangla date is shown in
  Bangla.

## 8. Emails and the ticket PDF

- `orders.locale` (`'en' | 'bn'`, default `'en'`): the language of the page
  the order was placed from. **Every email about that order uses it**, the
  rejected and expired emails included, even though the admin's action
  triggered them. The sign-in email uses the page's language; waitlist
  emails use the entry's own `locale`.
- Templates take a translator plus the formatters; the layout gets the
  Bangla font stack. Subject lines are translated too.
- **The PDF already bundles Noto Sans Bengali** (ADR for names). Before the
  labels are translated, a spike checks react-pdf's shaping of conjuncts
  and vowel signs (ক্ষ, ন্ত্র, কি, কৌ): if it mangles them, the PDF labels
  stay English and only the names are Bangla, with an ADR saying why.

## 9. Type and layout

- A Bangla face loaded with `next/font` (self-hosted at build time, no
  runtime Google request; CSP unchanged). Candidates: **Noto Sans
  Bengali** (safest, matches the PDF) or Anek Bangla (more character next
  to Archivo); the choice is made on a sample page.
- Bangla needs about 1.2× the line height for vowel signs above and below
  the line, and runs 15–30 % longer: every Bangla page is checked at
  360 px wide (the UI notes already left room for this).
- The Turnstile widget gets `language: 'bn'`.

## 10. Search engines and sharing

- `hreflang` alternates (`en`, `bn`, `x-default` = English) from the
  metadata builder in `src/lib/seo.ts`, and the same pairs in the sitemap.
- `og:locale` `bn_BD` with `en_US` as alternate; JSON-LD `inLanguage`.
- `STATIC_PUBLIC_PATHS` gains the `/bn` forms; the private areas have no
  `/bn` form to disallow.

## 11. Edge cache

`/bn/…` pages are separate URLs, so they are separate cache entries. The
rule's path list gains them (section 3). The contract from ADR-056 still
holds: a cached page renders the same for every anonymous visitor and sets
no cookie. The language cookie is set only by the switch action, never on
a page view. `tests/e2e/public-edge-cache.spec.ts` gains the `/bn` paths.

## 12. Tests

- Unit: every formatter in both languages (period boundaries, 12 AM/PM,
  lakh grouping, digit mapping), `normaliseDigits`, catalogue key parity.
- Type check: `bn satisfies Messages`.
- E2E: every public page in `/bn` (heading, CSP, no console errors); a full
  Bangla registration typed with Bangla digits; the switch keeps the page;
  a `ea_lang=bn` visitor on an English link lands on `/bn`; emails render
  in the order's language.
- With `PUBLIC_LOCALES=en`, the whole existing suite passes unchanged: the
  English site is untouched.

## Slices

| Slice  | What                                                                                                                                           | Size    |
| ------ | ---------------------------------------------------------------------------------------------------------------------------------------------- | ------- |
| **T0** | 12-hour time everywhere; Bangla digits accepted in every numeric field                                                                         | ½ day   |
| **L1** | next-intl, `/bn` routing behind the switch, proxy order, `lang`, font, Bangla formatters, language switch + cookie                             | 1½ days |
| **L2** | Extract every public string into `en.ts` (no visible change), then Bangla for the shell, home, events and event pages                          | 1½ days |
| **L3** | Registration, order, ticket and account pages in Bangla; error codes; Turnstile language; `orders.locale`                                      | 1½ days |
| **L4** | Emails and the PDF in Bangla (after the shaping spike)                                                                                         | 1 day   |
| **L5** | Bangla event fields in the admin; static and legal pages (after Raj's review); hreflang, sitemap, JSON-LD; cache rule; switch on in production | 1½ days |

Bangla goes live only after L5, when every page a buyer can reach is
translated and reviewed.

## Risks

| Risk                                                        | Answer                                                             |
| ----------------------------------------------------------- | ------------------------------------------------------------------ |
| Translations read like a machine wrote them                 | Raj reviews every page before the switch turns on                  |
| react-pdf breaks Bangla conjuncts                           | Spike first; fall back to English labels                           |
| A future page varies by cookie and gets cached for everyone | ADR-056 contract + the e2e cookie check on every cached path       |
| Moving the public tree under `[locale]` breaks a route      | The existing e2e suite runs unchanged on the English site after L1 |
