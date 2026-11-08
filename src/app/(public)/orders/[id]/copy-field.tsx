'use client';

import { useTranslations } from 'next-intl';
import { useState } from 'react';

/**
 * S6 CopyField: a mono value with a Copy button (order reference, bKash
 * number). The value stays in Latin digits on every page: a bKash app wants
 * `01712…`, not `০১৭১২…` (LOCALISATION.md §5).
 */
export function CopyField({ label, value }: { label: string; value: string }) {
  const t = useTranslations('copyField');
  const [copied, setCopied] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard unavailable (insecure context / permissions): nothing to do.
    }
  }

  return (
    <div className="flex items-stretch overflow-hidden rounded-lg border border-border-strong bg-card">
      <span className="sr-only">{label}</span>
      <span className="flex flex-1 items-center px-3.5 font-mono text-[17px] font-medium tracking-wide tabular">
        {value}
      </span>
      <button
        type="button"
        onClick={copy}
        className="border-l border-border-strong px-4 text-sm font-semibold hover:bg-secondary"
        aria-label={t('copyLabel', { label })}
      >
        {copied ? t('copied') : t('copy')}
      </button>
    </div>
  );
}
