'use client';

import { Dialog } from '@base-ui/react/dialog';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useState } from 'react';
import {
  type AccountLink,
  type FeaturedCta,
  PUBLIC_NAV,
  isPublicNavActive,
} from '@/lib/public-nav';
import { cn } from '@/lib/utils';
import { BrandMark } from './brand-mark';
import { CloseIcon, MenuIcon, PersonIcon } from './chrome-icons';

/** Tailwind's `lg`: the desktop header takes over, so an open menu has no reason to stay. */
const DESKTOP = '(min-width: 64rem)';

/**
 * Canvas 6, N4: under `lg` the header links move into a full-screen sheet —
 * 64px rows, the account row, and a bottom panel that either sells the
 * featured show or says nothing is on sale. Built on base-ui's Dialog
 * directly (not the shadcn Sheet, which is a side panel) for the focus trap,
 * Esc and focus return to the trigger.
 */
export function MobileMenu({
  cta,
  hasUpcoming = false,
  account,
  facebook,
}: {
  cta: FeaturedCta | null;
  /**
   * Some upcoming show exists. "Get tickets" follows only the featured show
   * (N3), so without a CTA another show may still be selling: then the
   * menu points at /events rather than claiming nothing is on sale.
   */
  hasUpcoming?: boolean;
  account: AccountLink;
  facebook: string | null;
}) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);

  // Close on any navigation, including back/forward while the menu is open.
  // Adjusting state during render (not in an effect) avoids painting the
  // new page under a stale open menu for a frame.
  const [shownOn, setShownOn] = useState(pathname);
  if (shownOn !== pathname) {
    setShownOn(pathname);
    setOpen(false);
  }

  // Rotating a tablet to landscape crosses into the desktop header.
  useEffect(() => {
    const desktop = window.matchMedia(DESKTOP);
    const onChange = () => {
      if (desktop.matches) setOpen(false);
    };
    desktop.addEventListener('change', onChange);
    return () => desktop.removeEventListener('change', onChange);
  }, []);

  // A link to the page already shown changes no path, so links close too.
  const close = () => setOpen(false);
  const button = 'flex size-11 items-center justify-center rounded-[8px]';

  return (
    <Dialog.Root open={open} onOpenChange={setOpen}>
      <Dialog.Trigger
        aria-label="Open menu"
        className={cn(
          button,
          'text-foreground group-data-[tone=dark]:text-[#fbfaf8] hover:bg-wash',
        )}
      >
        <MenuIcon />
      </Dialog.Trigger>
      <Dialog.Portal>
        {/* Portalled out of the header, so it repeats the chrome's focus-ring scope. */}
        <Dialog.Popup className="site-chrome fixed inset-0 z-50 flex h-dvh flex-col bg-background text-foreground print:hidden">
          <Dialog.Title className="sr-only">Menu</Dialog.Title>
          <div className="flex h-15 flex-none items-center justify-between border-b border-border px-4">
            <Link
              href="/"
              onClick={close}
              aria-label="echoandaura, home"
              className="flex min-h-11 items-center gap-2.5 font-heading text-[19px] font-bold tracking-[-0.02em]"
            >
              <BrandMark />
              echoandaura
            </Link>
            <Dialog.Close aria-label="Close menu" className={cn(button, 'hover:bg-secondary')}>
              <CloseIcon />
            </Dialog.Close>
          </div>

          <nav aria-label="Site" className="flex flex-1 flex-col overflow-y-auto px-4 py-2">
            {PUBLIC_NAV.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                onClick={close}
                aria-current={isPublicNavActive(item, pathname) ? 'page' : undefined}
                className="flex min-h-16 items-center justify-between gap-4 border-b border-border font-heading text-2xl font-semibold tracking-[-0.01em]"
              >
                {item.label}
                <span aria-hidden="true" className="text-xl text-muted-foreground">
                  →
                </span>
              </Link>
            ))}
            <Link
              href={account.href}
              onClick={close}
              className="flex min-h-16 items-center gap-3 text-lg text-muted-foreground"
            >
              <PersonIcon size={20} />
              {account.label}
            </Link>
          </nav>

          <div className="flex flex-none flex-col gap-3 border-t border-border bg-card px-4 pt-4 pb-[max(1.5rem,env(safe-area-inset-bottom))]">
            {cta ? (
              <>
                <p className="text-sm text-muted-foreground">
                  {cta.title} · {cta.dateLabel}
                </p>
                <Link
                  href={`/events/${cta.slug}/register`}
                  onClick={close}
                  className="flex h-13 items-center justify-center rounded-[8px] border border-foreground bg-marigold text-base font-semibold text-foreground hover:bg-[#e2962c]"
                >
                  Get tickets
                </Link>
              </>
            ) : hasUpcoming ? (
              <>
                <p className="text-sm text-muted-foreground">
                  Tickets for the next show are not on sale.
                </p>
                <Link
                  href="/events"
                  onClick={close}
                  className="flex h-13 items-center justify-center rounded-[8px] border border-border-strong bg-card text-base font-semibold hover:bg-secondary"
                >
                  See upcoming events
                </Link>
              </>
            ) : (
              <>
                <p className="text-sm text-muted-foreground">Nothing is on sale right now.</p>
                {facebook ? (
                  <a
                    href={facebook}
                    target="_blank"
                    rel="noreferrer"
                    className="flex h-13 items-center justify-center rounded-[8px] border border-border-strong bg-card text-base font-semibold hover:bg-secondary"
                  >
                    Follow on Facebook
                    <span className="sr-only"> (opens in a new tab)</span>
                  </a>
                ) : (
                  <Link
                    href="/archive"
                    onClick={close}
                    className="flex h-13 items-center justify-center rounded-[8px] border border-border-strong bg-card text-base font-semibold hover:bg-secondary"
                  >
                    See past events
                  </Link>
                )}
              </>
            )}
          </div>
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
