'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
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

// B2 mobile: under 1024px the sidebar becomes a sheet from the left; 48px rows.
export function MobileNav({ email, signOut }: Props) {
  const [open, setOpen] = useState(false);

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger render={<Button variant="ghost" size="icon" aria-label="Open navigation" />}>
        <span aria-hidden="true" className="text-lg leading-none">
          ☰
        </span>
      </SheetTrigger>
      <SheetContent side="left" className="w-72 gap-6 px-4 py-6">
        <SheetHeader className="p-0">
          <SheetTitle className="font-heading text-lg tracking-tight">echoandaura</SheetTitle>
          <SheetDescription className="sr-only">Admin navigation</SheetDescription>
        </SheetHeader>
        <AdminNav size="touch" onNavigate={() => setOpen(false)} />
        <div className="mt-auto flex flex-col gap-2 border-t border-border pt-4 text-sm">
          <span className="truncate text-muted-foreground">{email}</span>
          {signOut}
        </div>
      </SheetContent>
    </Sheet>
  );
}
