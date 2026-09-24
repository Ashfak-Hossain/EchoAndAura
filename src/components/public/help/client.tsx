'use client';

import { type ReactNode, useEffect } from 'react';

/**
 * Canvas 5's three bits of JavaScript. All are progressive enhancements:
 * without JS the anchors are plain links, the list shows its first item as
 * current, and printing is the browser's own ⌘P.
 */

/** K4 / K8a — marks the entry of the section being read (`aria-current`) in every list for `ids`. */
export function TocSpy({ ids }: { ids: string[] }) {
  useEffect(() => {
    let frame = 0;
    let lastHash = '';
    const mark = () => {
      frame = 0;
      let current = ids[0];
      for (const id of ids) {
        const el = document.getElementById(id);
        if (el && el.getBoundingClientRect().top < 140) current = id;
      }
      // A short last section can never scroll its top past the line: at the
      // bottom of the page, or right after a jump to it, it is the current one.
      const hash = decodeURIComponent(window.location.hash.slice(1));
      if (hash !== lastHash && ids.includes(hash)) current = hash;
      else if (window.innerHeight + window.scrollY >= document.documentElement.scrollHeight - 2) {
        current = ids[ids.length - 1];
      }
      lastHash = hash;
      for (const a of document.querySelectorAll<HTMLAnchorElement>('[data-toc] a[href^="#"]')) {
        a.setAttribute('aria-current', a.getAttribute('href') === `#${current}` ? 'true' : 'false');
      }
    };
    const schedule = () => {
      if (!frame) frame = requestAnimationFrame(mark);
    };
    mark();
    window.addEventListener('scroll', schedule, { passive: true });
    window.addEventListener('hashchange', mark);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener('scroll', schedule);
      window.removeEventListener('hashchange', mark);
    };
  }, [ids]);
  return null;
}

/**
 * K5 / K8b — a link to a section or an answer that also copies its full
 * URL, so it can be pasted into a message. The navigation still happens.
 */
export function AnchorLink({
  id,
  className,
  label,
  children,
}: {
  id: string;
  className?: string;
  label?: string;
  children: ReactNode;
}) {
  return (
    <a
      href={`#${id}`}
      aria-label={label}
      className={className}
      onClick={() => {
        const url = `${window.location.origin}${window.location.pathname}#${id}`;
        void navigator.clipboard?.writeText(url).catch(() => {});
      }}
    >
      {children}
    </a>
  );
}

/** K4 — "Print or save as PDF": the page's `print:` classes decide what prints. */
export function PrintLink({ className }: { className?: string }) {
  return (
    <button type="button" onClick={() => window.print()} className={className}>
      Print or save as PDF
    </button>
  );
}
