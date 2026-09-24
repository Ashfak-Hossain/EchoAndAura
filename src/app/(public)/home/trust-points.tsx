import type { ReactNode } from 'react';
import { REGISTRATION_CLOSES_DAYS_BEFORE } from '@/content/site';
import { CheckIcon, MailIcon, PhoneIcon } from './icons';

/**
 * A1 "Why book with echoandaura" (redesign 2026-09-21): a charcoal band
 * between the light sections — the three things a first-time buyer on a
 * manual-bKash site needs to hear, as titled cards with real icons. The
 * verification promise comes from the settings (B14) and the rename cut-off
 * from src/content/site.ts, so the promise here matches the policy pages.
 */
const points = (
  verificationPromise: string,
): { icon: ReactNode; title: string; text: string }[] => [
  {
    icon: <MailIcon />,
    title: 'Named tickets, by email',
    text: `Every ticket carries a name and a code. Give it to a friend by changing the name — until ${REGISTRATION_CLOSES_DAYS_BEFORE} days before the show.`,
  },
  {
    icon: <PhoneIcon />,
    title: 'Paid by bKash',
    text: 'Send from your own bKash and paste the TrxID. No card, no gateway fee on top of the ticket price.',
  },
  {
    icon: <CheckIcon />,
    title: 'Checked by a person',
    text: `Each payment is matched against the bKash statement — ${verificationPromise} — then the tickets go out.`,
  },
];

export function TrustPoints({ verificationPromise }: { verificationPromise: string }) {
  return (
    <section aria-labelledby="trust-heading" className="bg-foreground text-background">
      <div className="mx-auto flex w-full max-w-360 flex-col gap-6 px-4 py-10 lg:gap-10 lg:px-16 lg:py-16">
        <div className="flex max-w-[640px] flex-col gap-2">
          <p className="text-[11px] font-medium tracking-[0.14em] text-[#a8a29a] uppercase lg:text-xs">
            Why book with echoandaura
          </p>
          <h2
            id="trust-heading"
            className="font-heading text-[26px] leading-[1.15] font-semibold tracking-[-0.015em] text-pretty lg:text-[36px] lg:leading-[1.1]"
          >
            No card, no app, no queue at the gate. Just your ticket&apos;s QR.
          </h2>
        </div>
        <ul className="flex flex-col gap-3 lg:grid lg:grid-cols-3 lg:gap-8">
          {points(verificationPromise).map((p) => (
            <li
              key={p.title}
              className="flex gap-3.5 rounded-xl border border-[#33302a] bg-[#26231f] p-4.5 lg:flex-col lg:gap-3.5 lg:p-7"
            >
              <span
                aria-hidden="true"
                className="flex size-10 shrink-0 items-center justify-center rounded-[10px] bg-marigold text-foreground lg:size-11"
              >
                {p.icon}
              </span>
              <div className="flex flex-col gap-1 lg:gap-2">
                <h3 className="font-heading text-[17px] font-semibold lg:text-[20px]">{p.title}</h3>
                <p className="text-[14px] leading-relaxed text-[#c9c3b7] lg:text-[15px]">
                  {p.text}
                </p>
              </div>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
