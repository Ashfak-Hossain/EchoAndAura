import { headers } from 'next/headers';
import { auth } from '@/lib/auth';

// TEMPORARY DEMO MARKUP — dashboard content arrives with later Phase 1 slices.
export default async function AdminDashboardPage() {
  const session = await auth.api.getSession({ headers: await headers() });

  return (
    <section className="flex flex-col gap-2">
      <h1 className="text-xl font-semibold">Dashboard</h1>
      <p className="text-sm text-neutral-600">Signed in as {session?.user.email}</p>
    </section>
  );
}
