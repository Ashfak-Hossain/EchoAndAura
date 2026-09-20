'use client';

import { Printer } from 'lucide-react';

/** "Print list": the browser's print dialog renders the print sheet (globals.css `@media print`). */
export function PrintButton({ disabled, title }: { disabled?: boolean; title?: string }) {
  return (
    <button
      type="button"
      onClick={() => window.print()}
      disabled={disabled}
      title={title}
      className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-foreground bg-foreground px-3.5 text-[13px] font-semibold text-background hover:bg-[#33302a] disabled:cursor-not-allowed disabled:border-border disabled:bg-secondary disabled:text-[#a8a29a]"
    >
      <Printer className="size-3.5" aria-hidden="true" />
      Print list
    </button>
  );
}
