import Link from 'next/link';
import { MAX_TICKETS_PER_ORDER } from '@/server/lib/order-rules';
import { HOLD_HOURS } from '@/content/site';
import { cn } from '@/lib/utils';
import { SectionHeading, homeColumn, homeSection, sectionLink } from './section-heading';

/**
 * The three steps, built from the rules they describe: the order cap
 * (order-rules), the hold (content/site) and the organizer's verification
 * promise (B14 settings), so the home page never states a different number
 * from the order page or the policies.
 */
export function howItWorksSteps(verificationPromise: string) {
  return [
    {
      title: 'Register',
      body: `Choose a ticket type and up to ${MAX_TICKETS_PER_ORDER} tickets on one order, under one name. Your tickets are held for ${HOLD_HOURS} hours.`,
    },
    {
      title: 'Pay by bKash',
      body: `Send the amount by bKash and paste the TrxID. A person checks it, ${verificationPromise}, and your tickets are emailed.`,
    },
    {
      title: 'Scanned at the door',
      body: 'Show the QR code on your phone or on paper. Each ticket lets one person in, once.',
    },
  ];
}

/** N9 "How it works": three numbered cards (one column on phones), then the FAQ. */
export function HowItWorks({ verificationPromise }: { verificationPromise: string }) {
  return (
    <section aria-labelledby="how-heading" className={homeSection}>
      <div className={cn(homeColumn, 'flex flex-col gap-8')}>
        <div className="flex flex-col gap-2">
          <SectionHeading id="how-heading">How it works</SectionHeading>
          <p className="text-base text-muted-foreground lg:text-lg">
            No card, no app, no queue at the gate.
          </p>
        </div>
        {/* role="list": Safari drops list semantics once list-style is none. */}
        <ol role="list" className="grid grid-cols-1 gap-4 lg:grid-cols-3">
          {howItWorksSteps(verificationPromise).map((step, i) => (
            <li
              key={step.title}
              className="flex flex-col gap-3 rounded-lg border border-border bg-card p-6"
            >
              {/* The disc is for the eye; the heading carries "Step N" for a
                  screen reader, whatever the browser does with list numbering. */}
              <span
                aria-hidden="true"
                className="flex size-9 items-center justify-center rounded-full bg-foreground font-heading text-base font-semibold text-background"
              >
                {i + 1}
              </span>
              <h3 className="text-xl leading-[1.25] font-semibold">
                <span className="sr-only">Step {i + 1}: </span>
                {step.title}
              </h3>
              <p className="text-base leading-[1.6] text-pretty text-muted-foreground">
                {step.body}
              </p>
            </li>
          ))}
        </ol>
        <Link href="/faq" className={cn(sectionLink, 'self-start')}>
          Questions? Read the FAQ →
        </Link>
      </div>
    </section>
  );
}
