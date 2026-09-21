'use client';

import { Printer } from 'lucide-react';

/** Opens the browser's print dialog; the page's `print:` classes decide what prints (globals.css `@media print`). */
export function PrintButton({
  label = 'Print',
  disabled,
  title,
}: {
  label?: string;
  disabled?: boolean;
  title?: string;
}) {
  return (
    <button
      type="button"
      onClick={() => window.print()}
      disabled={disabled}
      title={title}
      className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-foreground bg-foreground px-3.5 text-[13px] font-semibold text-background hover:bg-[#33302a] disabled:cursor-not-allowed disabled:border-border disabled:bg-secondary disabled:text-[#a8a29a]"
    >
      <Printer className="size-3.5" aria-hidden="true" />
      {label}
    </button>
  );
}
