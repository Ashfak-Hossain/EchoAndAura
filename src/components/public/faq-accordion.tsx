import type { ReactNode } from 'react';
import { AnchorLink } from './help/client';
import { OpenFromHash } from './faq-open-from-hash';

export interface FaqItem {
  /** Anchor id — stable, shareable (`/faq#wrong-trxid`). */
  id: string;
  question: string;
  answer: ReactNode;
}

/**
 * K8b FAQ accordion (Canvas 5): one open at a time, the open item tinted
 * accent, every item a permanent anchor with a "Copy link" under its
 * answer. Native `<details name="faq">` gives the exclusivity without
 * JavaScript; the only script opens the item named in the URL hash.
 */
export function FaqAccordion({
  items,
  group = 'faq',
  openFromHash = true,
  footer,
}: {
  items: FaqItem[];
  group?: string;
  /** A last row inside the list (the FAQ's "covered in the refund policy" link). */
  footer?: ReactNode;
  /** One opener per page: a page with several accordions turns it off on all but one. */
  openFromHash?: boolean;
}) {
  return (
    <div className="flex flex-col gap-2">
      {items.map((item) => (
        <details
          key={item.id}
          id={item.id}
          name={group}
          className="group scroll-mt-24 rounded-xl border border-border bg-card open:border-accent-border [&:not([open]):hover]:border-border-strong"
        >
          <summary className="flex min-h-11 cursor-pointer list-none items-start gap-4 rounded-[calc(var(--radius)*1.4-1px)] px-5 py-4 group-open:rounded-b-none group-open:bg-accent group-[:not([open])]:hover:bg-secondary [&::-webkit-details-marker]:hidden">
            <span className="flex-1 text-base leading-[1.5] font-semibold">{item.question}</span>
            <span
              aria-hidden
              className="flex size-6 shrink-0 items-center justify-center font-mono text-xl text-muted-foreground group-open:hidden"
            >
              +
            </span>
            <span
              aria-hidden
              className="hidden size-6 shrink-0 items-center justify-center font-mono text-xl text-accent-ink group-open:flex"
            >
              −
            </span>
          </summary>
          <div className="flex flex-col gap-2 border-t border-accent-border px-5 pt-4 pb-3">
            <div className="rich-text">{item.answer}</div>
            <AnchorLink
              id={item.id}
              className="inline-flex min-h-11 items-center self-start font-mono text-xs text-muted-foreground no-underline hover:text-accent-ink"
            >
              Copy link · /faq#{item.id}
            </AnchorLink>
          </div>
        </details>
      ))}
      {footer}
      {openFromHash ? <OpenFromHash /> : null}
    </div>
  );
}
