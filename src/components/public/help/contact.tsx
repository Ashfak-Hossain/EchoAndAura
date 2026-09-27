import type { SiteSettings } from '@/server/services/settings.service';
import { REPLY_PROMISE } from '@/content/site';
import { cn } from '@/lib/utils';
import { overline } from './layout';

/** The part of the settings the contact pieces read (B14). */
export type ContactSettings = Pick<
  SiteSettings,
  'supportEmail' | 'supportPhone' | 'facebookPageUrl' | 'organizerName'
>;

function channels(settings: ContactSettings) {
  const { supportEmail: email, supportPhone: phone, facebookPageUrl: facebook } = settings;
  return [
    email
      ? {
          label: 'Email',
          value: email,
          href: `mailto:${email}`,
          action: 'Write an email',
          // Label-in-name (WCAG 2.5.3): the visible words, plus what they act on.
          actionName: `Write an email to ${email}`,
        }
      : null,
    phone
      ? {
          label: 'Phone',
          value: phone,
          href: `tel:${phone.replace(/\s+/g, '')}`,
          action: 'Call',
          actionName: `Call ${phone}`,
          tabular: true,
        }
      : null,
    facebook
      ? {
          label: 'Facebook',
          value: 'Facebook page',
          href: facebook,
          action: 'Open Facebook page ↗',
          actionName: 'Open Facebook page (opens in a new tab)',
          external: true,
        }
      : null,
  ].filter((c) => c !== null);
}

/**
 * K10 — no channel configured yet: say so, rather than render nothing (a
 * page that ends without a way to ask looks broken).
 */
export function ContactEmpty({ className }: { className?: string }) {
  return (
    <div
      className={cn(
        'flex max-w-170 flex-col gap-2 rounded-xl border border-dashed border-border-strong p-6',
        className,
      )}
    >
      <p className={cn(overline, 'text-muted-foreground')}>Not set up yet</p>
      <p className="font-heading text-lg leading-[1.35] font-semibold">
        Contact details are being set up
      </p>
      <p className="text-base leading-[1.6]">
        For now, reply to any email you have received from us.
      </p>
    </div>
  );
}

/**
 * K9 closing card — ends every help page: the organizer's channels from the
 * site settings, each omitted when unset; the empty state when none is.
 */
export function ContactCard({
  title = 'Still stuck?',
  settings,
}: {
  title?: string;
  settings: ContactSettings;
}) {
  const list = channels(settings);
  if (list.length === 0) return <ContactEmpty />;
  return (
    <aside
      aria-label="Contact the organizer"
      className="flex max-w-170 break-inside-avoid flex-col gap-4 rounded-xl border border-border bg-card p-6 shadow-sm print:border-black"
    >
      <div className="flex flex-col gap-1">
        <h2 className="font-heading text-xl leading-[1.3] font-semibold">{title}</h2>
        <p className="text-sm leading-[1.55] text-muted-foreground">
          Message {settings.organizerName} — {REPLY_PROMISE}. Quote your order reference if you have
          one.
        </p>
      </div>
      <ul>
        {list.map((c) => (
          <li key={c.label} className="border-t border-border">
            <a
              href={c.href}
              {...(c.external ? { target: '_blank', rel: 'noreferrer' } : {})}
              className="flex min-h-12 items-center gap-4 text-foreground"
            >
              <span className="w-18 shrink-0 text-sm text-muted-foreground">{c.label}</span>
              <span
                className={cn(
                  'min-w-0 flex-1 [overflow-wrap:anywhere] text-accent-ink underline underline-offset-2',
                  c.tabular && 'tabular',
                )}
              >
                {c.value}
                {c.external ? <span aria-hidden> ↗</span> : null}
              </span>
            </a>
          </li>
        ))}
      </ul>
    </aside>
  );
}

/** K9 cards — the Contact page's "Ways to reach us"; a missing channel drops its card. */
export function ContactChannels({ settings }: { settings: ContactSettings }) {
  const list = channels(settings);
  if (list.length === 0) return <ContactEmpty />;
  return (
    <div className="grid grid-cols-[repeat(auto-fill,minmax(260px,1fr))] gap-4">
      {list.map((c) => (
        <div
          key={c.label}
          className="flex flex-col gap-3 rounded-xl border border-border bg-card p-6 shadow-sm"
        >
          <p className={cn(overline, 'text-muted-foreground')}>{c.label}</p>
          <p
            className={cn(
              'font-heading text-xl leading-[1.3] font-semibold [overflow-wrap:anywhere]',
              c.tabular && 'tabular',
            )}
          >
            {c.value}
          </p>
          <p className="text-sm leading-[1.5] text-muted-foreground">
            {settings.organizerName} {REPLY_PROMISE}.
          </p>
          <a
            href={c.href}
            aria-label={c.actionName}
            {...(c.external ? { target: '_blank', rel: 'noreferrer' } : {})}
            className="mt-auto flex min-h-11 items-center justify-center rounded-lg border border-border-strong bg-card px-4 text-base font-semibold text-foreground hover:bg-secondary"
          >
            {c.action}
          </a>
        </div>
      ))}
    </div>
  );
}
