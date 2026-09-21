import type { ReactNode } from 'react';
import { formatInTimeZone } from 'date-fns-tz';
import type { SiteSettings } from '@/server/services/settings.service';
import { REPLY_PROMISE } from '@/content/site';
import { DHAKA_TZ } from '@/lib/time';

/**
 * A7 long-form template: eyebrow, title, "Last updated", then 16px prose at
 * a 560px measure. The body uses the `.rich-text` styles from globals.css so
 * policy pages read exactly like an event description — one prose style
 * for the whole public site. Server component; no session, no DB.
 */
export function StaticPage({
  eyebrow,
  title,
  lead,
  lastUpdated,
  children,
  wide = false,
}: {
  eyebrow: string;
  title: string;
  /** One-line intro under the title, outside the prose block. */
  lead?: ReactNode;
  lastUpdated?: Date;
  children: ReactNode;
  /** FAQ needs the accordion's full width; policies keep the 560px measure. */
  wide?: boolean;
}) {
  return (
    <main
      className={`mx-auto flex w-full flex-1 flex-col gap-8 px-4 py-10 lg:py-16 ${wide ? 'max-w-180' : 'max-w-140'}`}
    >
      <header className="flex flex-col gap-2">
        <p className="font-mono text-xs tracking-[0.14em] text-muted-foreground uppercase">
          {eyebrow}
        </p>
        <h1 className="font-heading text-[32px] leading-tight font-bold tracking-[-0.02em] lg:text-[40px]">
          {title}
        </h1>
        {lead ? <p className="text-[17px] leading-relaxed text-[#4a4640]">{lead}</p> : null}
        {lastUpdated ? (
          <p className="text-sm text-muted-foreground">
            Last updated {formatInTimeZone(lastUpdated, DHAKA_TZ, 'EEE d MMM yyyy')} (Dhaka)
          </p>
        ) : null}
      </header>
      {children}
    </main>
  );
}

/** The prose block of a policy page: h2 subheads, paragraphs, lists. */
export function Prose({ children }: { children: ReactNode }) {
  return <article className="rich-text text-[16px] text-[#2b2925]">{children}</article>;
}

/** The part of the settings the contact card reads. */
export type ContactSettings = Pick<
  SiteSettings,
  'supportEmail' | 'supportPhone' | 'facebookPageUrl' | 'organizerName'
>;

/**
 * Contact card closing every policy page: the organizer's channels from the
 * site settings (B14), each omitted when unset. Renders nothing when no
 * channel is configured, rather than an empty box.
 */
export function ContactCard({
  title = 'Still stuck?',
  settings,
}: {
  title?: string;
  settings: ContactSettings;
}) {
  const { supportEmail: email, supportPhone: phone, facebookPageUrl: facebook } = settings;
  if (!email && !phone && !facebook) return null;
  return (
    <aside
      aria-label="Contact the organizer"
      className="flex flex-col gap-3 rounded-xl border border-border bg-card p-5"
    >
      <p className="font-heading text-lg font-semibold">{title}</p>
      <p className="text-sm text-muted-foreground">
        Message {settings.organizerName} — {REPLY_PROMISE}. Quote your order reference if you have
        one.
      </p>
      <ul className="flex flex-col gap-1.5 text-[15px]">
        {email ? (
          <li>
            <a href={`mailto:${email}`} className="underline underline-offset-2">
              {email}
            </a>
          </li>
        ) : null}
        {phone ? (
          <li className="tabular">
            <a href={`tel:${phone.replace(/\s+/g, '')}`} className="underline underline-offset-2">
              {phone}
            </a>
          </li>
        ) : null}
        {facebook ? (
          <li>
            <a
              href={facebook}
              target="_blank"
              rel="noreferrer"
              className="underline underline-offset-2"
            >
              Facebook page
            </a>
          </li>
        ) : null}
      </ul>
    </aside>
  );
}
