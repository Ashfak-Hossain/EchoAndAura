import { SectionHeading } from './section-heading';

/**
 * A1 "Why book with echoandaura": the three things a first-time buyer on a
 * manual-bKash site needs to hear. Copy is fixed by the design — the 4-hour
 * figure is the verification SLA agreed with Raj (PHASES.md risk register).
 */
const POINTS: { glyph: string; text: string }[] = [
  { glyph: '✉', text: 'Named tickets delivered by email' },
  { glyph: '৳', text: 'Pay with bKash — no card needed' },
  { glyph: '✓', text: 'Every payment is checked by a person, usually within 4 hours' },
];

export function TrustPoints() {
  return (
    <section aria-labelledby="trust-heading" className="flex flex-col gap-3.5">
      <SectionHeading id="trust-heading">Why book with echoandaura</SectionHeading>
      <ul className="flex flex-col gap-2.5 lg:grid lg:grid-cols-3 lg:gap-4">
        {POINTS.map((p) => (
          <li
            key={p.text}
            className="flex items-center gap-3.5 rounded-xl border border-border bg-card px-4 py-3.5 lg:flex-col lg:items-start lg:gap-3 lg:p-5"
          >
            <span
              aria-hidden="true"
              className="flex size-9 shrink-0 items-center justify-center rounded-full bg-accent font-heading text-base font-semibold text-accent-ink"
            >
              {p.glyph}
            </span>
            <span className="text-[15px] leading-snug text-pretty">{p.text}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}
