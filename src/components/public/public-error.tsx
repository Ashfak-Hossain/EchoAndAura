'use client';

import { useTranslations } from 'next-intl';
import Link from '@/i18n/link';
import { useEffect, useState } from 'react';
import { Button, buttonVariants } from '@/components/button';
import { ErrorPage, errorReference, randomReference } from '@/components/error-page';
import { reportBoundaryError } from '@/lib/error-tracking/client';

/**
 * A8 — the public site's error boundary. Rendered inside the public shell
 * (header and footer stay), so the buyer still has the nav. Next logs the
 * error and its digest on the server; here we only show the reference.
 */
export default function PublicError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  // A client-side error has no digest: make one reference (lazy state, so
  // it is computed once) and keep it across re-renders.
  const t = useTranslations('errors');
  const [fallback] = useState(randomReference);
  const reference = errorReference(error.digest, () => fallback);

  useEffect(() => {
    reportBoundaryError(error);
    console.error(`[${reference}]`, error);
  }, [error, reference]);

  return (
    <ErrorPage
      reference={reference}
      text={{
        eyebrow: t('eyebrow'),
        title: t('title'),
        copy: t('copy'),
        reference: t('reference'),
        quote: t('quote'),
      }}
      actions={
        <>
          <Button onClick={reset}>{t('tryAgain')}</Button>
          <Link href="/contact" className={buttonVariants({ variant: 'secondary' })}>
            {t('messageOrganizer')}
          </Link>
        </>
      }
    />
  );
}
