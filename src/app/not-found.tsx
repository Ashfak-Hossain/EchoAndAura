import PublicLayout from './(public)/layout';
import PublicNotFound from './(public)/not-found';

/**
 * The 404 for a URL no route matches (a typo, an old link). Before ADR-043
 * this was Next's default page, prerendered at build: unbranded, and
 * without the per-request CSP nonce its scripts would be blocked. Wrapping
 * the public 404 in the public layout gives it the site's header and
 * footer, and the layout's session read makes it render per request.
 */
export default function NotFound() {
  return (
    <PublicLayout>
      <PublicNotFound />
    </PublicLayout>
  );
}
