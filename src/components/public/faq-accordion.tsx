import type { ReactNode } from 'react';
import { OpenFromHash } from './faq-open-from-hash';

export interface FaqItem {
  /** Anchor id — stable, shareable (`/faq#wrong-trxid`). */
  id: string;
  question: string;
  answer: ReactNode;
}

/**
 * A7 FAQ accordion (canvas 2): one open at a time, the open row tinted
 * accent, every row a real anchor so an answer can be shared. Native
 * `<details name="faq">` gives the exclusivity without JavaScript; the only
 * script is the one that opens the item named in the URL hash on load.
 */
export function FaqAccordion({ items, group = 'faq' }: { items: FaqItem[]; group?: string }) {
  return (
    <div className="flex flex-col gap-2">
      {items.map((item) => (
        <details
          key={item.id}
          id={item.id}
          name={group}
          className="group rounded-xl border border-border bg-card open:border-marigold open:bg-accent"
        >
          <summary className="flex cursor-pointer list-none items-start justify-between gap-4 px-5 py-4 text-[16px] font-medium [&::-webkit-details-marker]:hidden">
            <span className="flex-1">
              {item.question}{' '}
              {/* The shareable anchor: the summary text toggles, this link sets the hash. */}
              <a
                href={`#${item.id}`}
                aria-label={`Link to: ${item.question}`}
                className="ml-1 font-mono text-sm text-muted-foreground opacity-0 transition-opacity group-open:opacity-100 hover:underline focus-visible:opacity-100"
              >
                #
              </a>
            </span>
            <span
              aria-hidden
              className="mt-0.5 font-mono text-lg leading-none text-muted-foreground group-open:hidden"
            >
              +
            </span>
            <span
              aria-hidden
              className="mt-0.5 hidden font-mono text-lg leading-none text-accent-ink group-open:inline"
            >
              −
            </span>
          </summary>
          <div className="rich-text px-5 pb-5 text-[15px] text-[#2b2925]">{item.answer}</div>
        </details>
      ))}
      <OpenFromHash />
    </div>
  );
}
