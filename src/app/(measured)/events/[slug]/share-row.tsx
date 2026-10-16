'use client';

import { useTranslations } from 'next-intl';
import { useState } from 'react';

interface Props {
  url: string;
  title: string;
}

// A2 share row: Facebook, WhatsApp, Copy link — 44px secondary buttons.
export function ShareRow({ url, title }: Props) {
  const t = useTranslations('share');
  const [copied, setCopied] = useState(false);
  const encoded = encodeURIComponent(url);
  const btn =
    'flex h-11 flex-1 items-center justify-center rounded-lg border border-border-strong bg-card px-4 text-sm font-semibold hover:bg-secondary lg:flex-none lg:px-[18px]';

  async function copy() {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard unavailable (insecure context / permissions): nothing to do.
    }
  }

  return (
    <div className="flex gap-2 lg:gap-2.5" aria-label={t('label')}>
      <a
        href={`https://www.facebook.com/sharer/sharer.php?u=${encoded}`}
        target="_blank"
        rel="noreferrer"
        className={btn}
      >
        <span className="lg:hidden">{t('facebook')}</span>
        <span className="hidden lg:inline">{t('shareFacebook')}</span>
      </a>
      <a
        href={`https://wa.me/?text=${encodeURIComponent(`${title} ${url}`)}`}
        target="_blank"
        rel="noreferrer"
        className={btn}
      >
        WhatsApp
      </a>
      <button type="button" onClick={() => void copy()} className={btn} aria-live="polite">
        {copied ? t('copied') : t('copyLink')}
      </button>
    </div>
  );
}
