'use client';

import { useState } from 'react';
import { Button, buttonVariants } from '@/components/button';
import { ErrorPage, errorReference, randomReference } from '@/components/error-page';
import './globals.css';

/**
 * A8 when the root layout itself failed: this must render its own
 * <html>/<body>, and nothing from the app (fonts, shell) can be assumed.
 * Same copy and reference as the public boundary.
 */
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const [fallback] = useState(randomReference);
  const reference = errorReference(error.digest, () => fallback);

  return (
    <html lang="en" className="h-full font-sans antialiased">
      <body className="flex min-h-full flex-col">
        <ErrorPage
          reference={reference}
          actions={
            <>
              <Button onClick={reset}>Try again</Button>
              <a href="/contact" className={buttonVariants({ variant: 'secondary' })}>
                Message the organizer
              </a>
            </>
          }
        />
      </body>
    </html>
  );
}
