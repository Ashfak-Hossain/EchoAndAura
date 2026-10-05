import type { ReactNode } from 'react';

/**
 * A8 "something broke". Reassures about money and tickets first, then
 * two ways out. The reference is Next's error `digest` (also printed in
 * the server log), so what the buyer quotes is what Raj can grep for.
 * Plain markup, no hooks: rendered by the client error boundaries and by
 * `global-error.tsx`, which has no layout around it.
 */
/** The page's words; English by default (global-error has no translations). */
export interface ErrorPageText {
  eyebrow: string;
  title: string;
  copy: string;
  reference: string;
  quote: string;
}

const ENGLISH: ErrorPageText = {
  eyebrow: '500 · Something broke',
  title: "We've hit a problem",
  copy: 'Nothing you did caused this and no payment was affected. Try again in a minute; if it keeps happening, message the organizer.',
  reference: 'Reference',
  quote: 'quote this if you get in touch',
};

export function ErrorPage({
  reference,
  actions,
  copy,
  text = ENGLISH,
}: {
  reference: string;
  actions: ReactNode;
  copy?: string;
  /** ADR-061: the public boundary passes the page's language. */
  text?: ErrorPageText;
}) {
  return (
    <main className="mx-auto flex w-full max-w-160 flex-1 flex-col items-center justify-center gap-4 px-4 py-24 text-center">
      <p className="font-mono text-xs tracking-[0.14em] text-muted-foreground uppercase">
        {text.eyebrow}
      </p>
      <h1 className="font-heading text-3xl font-bold tracking-[-0.02em]">{text.title}</h1>
      <p className="max-w-md text-[15px] leading-relaxed text-muted-foreground">
        {copy ?? text.copy}
      </p>
      <dl className="mt-2 flex flex-col items-center gap-1">
        <dt className="text-xs font-medium tracking-widest text-muted-foreground uppercase">
          {text.reference}
        </dt>
        <dd
          className="font-mono text-[22px] font-medium tracking-wide tabular select-all"
          data-testid="error-reference"
        >
          {reference}
        </dd>
        <dd className="text-sm text-muted-foreground">{text.quote}</dd>
      </dl>
      <div className="mt-2 flex flex-wrap justify-center gap-2">{actions}</div>
    </main>
  );
}

/**
 * `ERR-` + the first 8 characters of Next's digest. Without a digest (an
 * error thrown on the client) the caller supplies a random one, made once.
 */
export function errorReference(digest: string | undefined, fallback: () => string): string {
  const raw = digest
    ?.replace(/[^0-9a-z]/gi, '')
    .slice(0, 8)
    .toUpperCase();
  return `ERR-${raw && raw.length >= 4 ? raw : fallback()}`;
}

/** Random 5-character reference from the unambiguous alphabet (no 0/O, 1/I). */
export function randomReference(random: () => number = Math.random): string {
  const alphabet = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  let out = '';
  for (let i = 0; i < 5; i++) out += alphabet[Math.floor(random() * alphabet.length)];
  return out;
}
