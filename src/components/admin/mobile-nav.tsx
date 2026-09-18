'use client';

import { useState } from 'react';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from '@/components/ui/sheet';
import { AdminNav } from './admin-nav';

interface Props {
  email: string;
  signOut: React.ReactNode;
}

// B2 mobile: under 1024px the sidebar becomes a 280px charcoal sheet from the
// left; 48px rows on touch.
export function MobileNav({ email, signOut }: Props) {
  const [open, setOpen] = useState(false);

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger
        aria-label="Open navigation"
        className="flex size-11 items-center justify-center rounded-lg text-[19px] leading-none hover:bg-secondary"
      >
        <span aria-hidden="true">☰</span>
      </SheetTrigger>
      <SheetContent
        side="left"
        showCloseButton={false}
        className="w-[280px] max-w-[85vw] gap-0 border-0 bg-sidebar px-3.5 py-[18px] text-sidebar-foreground"
      >
        <SheetHeader className="px-2 pt-0 pb-4">
          <SheetTitle className="font-heading text-[17px] font-semibold tracking-tight text-sidebar-accent-foreground">
            echoandaura
          </SheetTitle>
          <SheetDescription className="sr-only">Admin navigation</SheetDescription>
        </SheetHeader>
        <AdminNav size="touch" onNavigate={() => setOpen(false)} />
        <div className="mt-auto flex flex-col gap-1.5 border-t border-sidebar-border px-2 pt-3 text-sm">
          <span className="truncate text-sidebar-accent-foreground">{email}</span>
          {signOut}
        </div>
      </SheetContent>
    </Sheet>
  );
}
