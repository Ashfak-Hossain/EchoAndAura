import type { Metadata } from 'next';
import { connection } from 'next/server';
import { PublicShell } from '@/components/public/public-shell';
import PublicNotFound from '@/components/public/public-not-found';
import { RootDocument, rootMetadata } from './root-document';

export const metadata: Metadata = { ...rootMetadata, robots: { index: false, follow: false } };

/**
 * The 404 for a URL no route matches (a typo, an old link, `/api/nope`).
 * ADR-079: with several root layouts there is no single layout to put a
 * not-found page in, so Next renders this whole document instead.
 *
 * Per request on purpose (ADR-043): Next stamps the CSP nonce only on a
 * page it renders per request; prerendered, this page's scripts would be
 * blocked. `connection()` says so outright rather than leaning on the
 * shell's session read. Never measured: no beacon here.
 */
export default async function GlobalNotFound() {
  await connection();
  return (
    <RootDocument root="global">
      <PublicShell>
        <PublicNotFound />
      </PublicShell>
    </RootDocument>
  );
}
