'use client';

import Link from 'next/link';
import { useState } from 'react';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from '@/components/ui/sheet';

export interface NavLink {
  href: string;
  label: string;
}

/** Public header under `lg`: the same links in a right-hand sheet, 48px rows. */
export function MobileNav({ links, facebook }: { links: NavLink[]; facebook: string | null }) {
  const [open, setOpen] = useState(false);
  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger
        aria-label="Open menu"
        className="flex size-11 items-center justify-center rounded-lg hover:bg-secondary"
      >
        <svg
          aria-hidden="true"
          width="22"
          height="22"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
        >
          <path d="M4 7h16M4 12h16M4 17h16" />
        </svg>
      </SheetTrigger>
      <SheetContent side="right" className="w-72 max-w-[85vw] gap-0 px-4 py-5">
        <SheetHeader className="px-2 pt-0 pb-3">
          <SheetTitle className="font-heading text-[17px] font-semibold tracking-tight">
            echoandaura
          </SheetTitle>
          <SheetDescription className="sr-only">Site navigation</SheetDescription>
        </SheetHeader>
        <nav aria-label="Site (menu)" className="flex flex-col">
          {links.map((l) => (
            <Link
              key={l.href}
              href={l.href}
              onClick={() => setOpen(false)}
              className="flex h-12 items-center rounded-lg px-2 text-[16px] font-medium hover:bg-secondary"
            >
              {l.label}
            </Link>
          ))}
          {facebook ? (
            <a
              href={facebook}
              target="_blank"
              rel="noreferrer"
              className="flex h-12 items-center rounded-lg px-2 text-[16px] font-medium text-accent-ink hover:bg-secondary"
            >
              Facebook
            </a>
          ) : null}
        </nav>
      </SheetContent>
    </Sheet>
  );
}
