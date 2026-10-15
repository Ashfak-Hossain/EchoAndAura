'use client';

import { useLayoutEffect } from 'react';
import { takeOverClick } from '@/lib/web-analytics';

/** Set once the guard is on in this document; the beacon never leaves either. */
let guarding = false;

/**
 * ADR-077: rendered only next to the beacon. A link from here to a page that
 * is not measured (an order, a ticket, the register form) becomes a full
 * page load, so the beacon never reaches that page: its last report, sent
 * as this page unloads, still carries this page's address.
 *
 * Listens on `window` in the capture phase, before React's own listener, so
 * `<Link>` sees the click already handled and stays out of the way, and no
 * other handler gets to navigate in-app first. Clicks the browser handles
 * itself (a new tab, a download) are left alone. A layout effect, so the
 * guard is on in the same commit that makes the links live. Never removed:
 * a refresh that unmounts this component does not unload the beacon.
 */
export function WebAnalyticsGuard() {
  useLayoutEffect(() => {
    if (guarding) return;
    guarding = true;
    window.addEventListener(
      'click',
      (event) => {
        const target = event.target instanceof Element ? event.target : null;
        const anchor = target?.closest('a[href]');
        // An SVG <a> is left to the browser, a full load; <Link> never renders one.
        const link =
          anchor instanceof HTMLAnchorElement
            ? {
                href: anchor.href,
                target: anchor.target,
                download: anchor.hasAttribute('download'),
              }
            : null;
        if (!link || !takeOverClick(event, link, window.location.href)) return;
        event.preventDefault();
        event.stopPropagation();
        window.location.assign(link.href);
      },
      { capture: true },
    );
  }, []);
  return null;
}
