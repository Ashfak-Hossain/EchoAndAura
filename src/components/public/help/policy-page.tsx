import Link from 'next/link';
import { HELP_PAGES, POLICY_KEYS, type PolicyDoc, type PolicyKey } from '@/content/policies';
import { cn } from '@/lib/utils';
import { AnchorLink, PrintLink, TocSpy } from './client';
import { type ContactSettings, ContactCard } from './contact';
import { HelpHeader, HelpMain, overline } from './layout';

/**
 * Canvas 5 policy template (A7.1–A7.3): Terms, Privacy and Refunds read
 * as one set — a switcher across them, a short version, a table of
 * contents (sticky on desktop, collapsed on phones), numbered sections
 * with shareable anchors, related policies and the contact card. Prints on
 * A4 as the prose alone, headed by a one-line source.
 */
export function PolicyPage({
  doc,
  lastUpdated,
  host,
  settings,
}: {
  doc: PolicyDoc;
  lastUpdated: Date;
  /** "echoandaura.com" — the printed page says where it came from. */
  host: string;
  settings: ContactSettings;
}) {
  const page = HELP_PAGES[doc.key];
  const toc = doc.sections.map((s, i) => ({ id: s.id, n: i + 1, title: s.title }));
  return (
    <HelpMain>
      <p className="mb-6 hidden border-b border-black pb-2 text-xs print:block">
        echoandaura · {host}
        {page.path}
      </p>
      <PolicySwitcher current={doc.key} />
      <HelpHeader
        eyebrow="Help & policies"
        title={page.title}
        lead={page.description}
        lastUpdated={lastUpdated}
        className="lg:pt-6"
      />

      <div className="grid items-start pt-6 lg:grid-cols-[240px_minmax(0,680px)] lg:gap-x-16 lg:pt-10 print:block">
        <aside className="top-24 hidden flex-col gap-3 lg:flex print:hidden [@media(min-height:44rem)]:sticky">
          <p className={cn(overline, 'text-muted-foreground')}>On this page</p>
          <nav aria-label="On this page" data-toc="">
            <ol className="border-l border-border">
              {toc.map((t, i) => (
                <li key={t.id} className="-ml-px">
                  <a
                    href={`#${t.id}`}
                    aria-current={i === 0 ? 'true' : 'false'}
                    className="flex min-h-10 items-start gap-3 rounded-r-sm border-l-2 border-transparent px-3 py-2.5 text-sm leading-[1.45] text-muted-foreground hover:bg-secondary hover:text-foreground aria-current:border-foreground aria-current:font-semibold aria-current:text-foreground"
                  >
                    <span className="w-4 shrink-0 font-normal text-muted-foreground tabular">
                      {t.n}
                    </span>
                    <span>{t.title}</span>
                  </a>
                </li>
              ))}
            </ol>
          </nav>
          <div className="flex flex-col gap-1 border-t border-border pt-3">
            <PrintLink className="flex min-h-10 items-center rounded-lg px-3 text-left text-sm hover:bg-secondary" />
            <a
              href="#top"
              className="flex min-h-10 items-center rounded-lg px-3 text-sm text-foreground hover:bg-secondary"
            >
              Back to top ↑
            </a>
          </div>
        </aside>

        <article className="flex min-w-0 flex-col gap-8">
          <ShortVersion items={doc.shortVersion} />

          <details className="group rounded-xl border border-border bg-card lg:hidden print:hidden">
            <summary className="flex min-h-12 cursor-pointer list-none items-center justify-between gap-3 rounded-xl px-4 group-open:rounded-b-none [&::-webkit-details-marker]:hidden">
              <span className="flex items-baseline gap-2">
                <span className="text-base font-semibold">On this page</span>
                <span className="text-sm text-muted-foreground tabular">{toc.length} sections</span>
              </span>
              <span
                aria-hidden
                className="text-muted-foreground transition-transform group-open:rotate-180"
              >
                ▾
              </span>
            </summary>
            <nav aria-label="On this page" data-toc="">
              <ol className="border-t border-border px-2 pt-1 pb-2">
                {toc.map((t) => (
                  <li key={t.id}>
                    <a
                      href={`#${t.id}`}
                      className="flex min-h-11 items-center gap-3 rounded-lg px-2 text-base text-foreground hover:bg-secondary"
                    >
                      <span className="w-5 shrink-0 text-muted-foreground tabular">{t.n}</span>
                      {t.title}
                    </a>
                  </li>
                ))}
              </ol>
            </nav>
          </details>

          <div className="rich-text">{doc.intro}</div>

          {doc.sections.map((s, i) => (
            <section
              key={s.id}
              id={s.id}
              aria-labelledby={`${s.id}-title`}
              className="flex scroll-mt-24 flex-col gap-4 border-t border-border pt-8"
            >
              <div className="flex break-after-avoid items-start gap-2">
                <h2
                  id={`${s.id}-title`}
                  className="flex flex-1 gap-3 font-heading text-xl leading-[1.3] font-semibold tracking-[-0.01em] lg:text-2xl"
                >
                  <span className="min-w-7 shrink-0 text-muted-foreground tabular">{i + 1}</span>
                  <span>{s.title}</span>
                </h2>
                <AnchorLink
                  id={s.id}
                  label={`Copy link to section ${i + 1}`}
                  className="-mt-1.5 -mr-2.5 flex size-11 shrink-0 items-center justify-center rounded-lg font-mono text-lg text-muted-foreground no-underline hover:bg-secondary hover:text-accent-ink print:hidden"
                >
                  #
                </AnchorLink>
              </div>
              <div className="rich-text [&>*+*]:mt-4">{s.body}</div>
            </section>
          ))}

          <RelatedPolicies exclude={doc.key} className="border-t border-border pt-8" />
          <ContactCard title={doc.contactTitle} settings={settings} />
        </article>
      </div>
      <TocSpy ids={toc.map((t) => t.id)} />
    </HelpMain>
  );
}

/** K2 — Terms · Privacy · Refunds, the current one raised; full width on phones. */
export function PolicySwitcher({ current }: { current: PolicyKey }) {
  return (
    <nav aria-label="Policies" className="pt-6 lg:pt-12 print:hidden">
      <div className="flex w-full gap-1 rounded-lg border border-border bg-secondary p-1 lg:inline-flex lg:w-auto">
        {POLICY_KEYS.map((k) => (
          <Link
            key={k}
            href={HELP_PAGES[k].path}
            aria-current={k === current ? 'page' : undefined}
            className="flex min-h-11 flex-1 items-center justify-center rounded-sm border border-transparent px-4 text-sm font-medium whitespace-nowrap text-muted-foreground hover:text-foreground aria-[current=page]:border-border-strong aria-[current=page]:bg-card aria-[current=page]:font-semibold aria-[current=page]:text-foreground aria-[current=page]:shadow-sm"
          >
            {HELP_PAGES[k].tab}
          </Link>
        ))}
      </div>
    </nav>
  );
}

/** K3 — 3–5 plain-language points restating the sections below. */
export function ShortVersion({ items }: { items: React.ReactNode[] }) {
  return (
    <section
      aria-labelledby="short-version"
      className="flex break-inside-avoid flex-col gap-4 rounded-xl border border-border bg-card p-6 shadow-sm print:border-black print:shadow-none"
    >
      <h2 id="short-version" className={cn(overline, 'text-accent-ink')}>
        The short version
      </h2>
      <ul className="flex flex-col gap-3">
        {items.map((item, i) => (
          <li key={i} className="flex gap-3 text-base leading-[1.55]">
            <span aria-hidden className="mt-2.25 size-1.5 shrink-0 rounded-[1px] bg-marigold" />
            <span>{item}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}

/**
 * K7 — the other help pages as whole-card links. `auto-fit`, so two cards
 * share a 680 px column and About's four sit in one row. `title: null`
 * when the surrounding section already names them (About's fine print).
 */
export function RelatedPolicies({
  exclude,
  keys = POLICY_KEYS,
  title = 'Related policies',
  className,
}: {
  exclude?: keyof typeof HELP_PAGES;
  keys?: readonly (keyof typeof HELP_PAGES)[];
  title?: string | null;
  className?: string;
}) {
  return (
    <section
      aria-labelledby={title ? 'related' : undefined}
      aria-label={title ? undefined : 'Policies and help'}
      className={cn('flex flex-col gap-4 print:hidden', className)}
    >
      {title ? (
        <h2 id="related" className={cn(overline, 'text-muted-foreground')}>
          {title}
        </h2>
      ) : null}
      <div className="grid grid-cols-[repeat(auto-fit,minmax(200px,1fr))] gap-4">
        {keys
          .filter((k) => k !== exclude)
          .map((k) => (
            <Link
              key={k}
              href={HELP_PAGES[k].path}
              className="flex flex-col gap-2 rounded-xl border border-border bg-card p-5 text-foreground hover:border-border-strong hover:shadow-md"
            >
              <span className="font-heading text-lg leading-[1.3] font-semibold">
                {HELP_PAGES[k].title}
              </span>
              <span className="text-sm leading-normal text-muted-foreground">
                {HELP_PAGES[k].description}
              </span>
              <span className="text-sm font-semibold text-accent-ink">
                Read <span aria-hidden>→</span>
              </span>
            </Link>
          ))}
      </div>
    </section>
  );
}
