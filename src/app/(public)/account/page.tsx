import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { ordersService } from '@/server/container';
import { Money } from '@/components/money';
import { StatusChip } from '@/components/status-chip';
import { getPublicSession } from '@/lib/session';
import { formatDhakaLong } from '@/lib/time';
import { signOutBuyerAction } from './sign-in/actions';

export const metadata: Metadata = { title: 'My orders', robots: { index: false } };
export const dynamic = 'force-dynamic';

/** Every order placed with the signed-in email. Proof of the email is the access rule. */
export default async function AccountPage() {
  const session = await getPublicSession();
  if (!session) redirect('/account/sign-in');
  const orders = await ordersService.listForBuyer(session.email);

  return (
    <div className="mx-auto flex w-full max-w-160 flex-1 flex-col gap-6 px-4 py-8 lg:py-12">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex flex-col gap-1">
          <h1 className="font-heading text-[28px] leading-tight font-bold tracking-[-0.02em]">
            My orders
          </h1>
          <p className="text-sm text-muted-foreground">Signed in as {session.email}</p>
        </div>
        <form action={signOutBuyerAction}>
          <button
            type="submit"
            className="flex h-10 items-center rounded-lg border border-border-strong bg-card px-3.5 text-sm font-semibold hover:bg-secondary"
          >
            Sign out
          </button>
        </form>
      </header>

      {orders.length === 0 ? (
        <div className="flex flex-col items-center gap-3 rounded-xl border border-dashed border-border-strong px-6 py-12 text-center">
          <p className="text-[15px] font-semibold">No orders under this email yet</p>
          <p className="text-sm text-muted-foreground">
            Orders show up here as soon as you register for an event with {session.email}.
          </p>
          <Link href="/" className="text-sm font-semibold underline">
            See upcoming events
          </Link>
        </div>
      ) : (
        <ul className="flex flex-col gap-3" data-testid="my-orders">
          {orders.map(({ order, eventTitle, ticketTypeName }) => (
            <li key={order.id}>
              <Link
                href={`/orders/${order.id}`}
                className="flex flex-col gap-2 rounded-xl border border-border bg-card p-4 hover:border-border-strong"
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="font-mono font-semibold">{order.reference}</span>
                  <StatusChip kind="order" status={order.status} />
                </div>
                <div className="text-[15px] font-medium">{eventTitle}</div>
                <div className="flex flex-wrap items-baseline justify-between gap-2 text-sm text-muted-foreground tabular">
                  <span>
                    {ticketTypeName} × {order.quantity} · <Money paisa={order.totalPaisa} />
                  </span>
                  <span>{formatDhakaLong(order.createdAt)} (Dhaka)</span>
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
