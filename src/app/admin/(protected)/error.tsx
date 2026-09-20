'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { Button, buttonVariants } from '@/components/button';
import { ErrorPage, errorReference, randomReference } from '@/components/error-page';

/** A8 for the admin: same page, admin wording and ways out. */
export default function AdminError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const [fallback] = useState(randomReference);
  const reference = errorReference(error.digest, () => fallback);

  useEffect(() => {
    console.error(`[${reference}]`, error);
  }, [error, reference]);

  return (
    <ErrorPage
      reference={reference}
      copy="The page failed to load. No order was changed by this. Try again; if it keeps happening, quote the reference below to the developer."
      actions={
        <>
          <Button onClick={reset}>Try again</Button>
          <Link href="/admin" className={buttonVariants({ variant: 'secondary' })}>
            Back to dashboard
          </Link>
        </>
      }
    />
  );
}
