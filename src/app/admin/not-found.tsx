import { PublicShell } from '@/components/public/public-shell';
import PublicNotFound from '@/components/public/public-not-found';

/** An unknown admin record (`notFound()`): the public 404, as before ADR-079. */
export default function AdminNotFound() {
  return (
    <PublicShell>
      <PublicNotFound />
    </PublicShell>
  );
}
