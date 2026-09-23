import type { Metadata } from 'next';
import Link from 'next/link';
import { differenceInCalendarDays } from 'date-fns';
import { dashboardService, eventsService, ticketTypesService } from '@/server/container';
import { quietDay, vsYesterday } from '@/server/services/dashboard.service';
import { ButtonLink } from '@/components/button-link';
import { EmptyState } from '@/components/empty-state';
import { Money } from '@/components/money';
import { ProgressBar } from '@/components/progress-bar';
import { StatCard } from '@/components/stat-card';
import { Chip, StatusChip } from '@/components/status-chip';
import { ticketTypeSaleState } from '@/lib/status-labels';
import { formatDhakaLong, formatRelative } from '@/lib/time';

export const metadata: Metadata = { title: 'Dashboard' };
// Live numbers on every load — "today" moves.
export const dynamic = 'force-dynamic';

/**
 * B3, laid out as designed. The StatCard row is ordered by urgency; zero
 * states say what is true rather than a bare 0. Every number is defined as
 * B9 and B12 define it (dashboard.service.ts), so the three pages agree.
 */
export default async function AdminDashboardPage() {
  const now = new Date();
  const events = await eventsService.listEvents();

  if (events.length === 0) {
    // B3 — first run.
    return (
      <EmptyState
        title="Create your first event"
        description="Add the date, venue and ticket types. Nothing is public until you press Publish."
        action={<ButtonLink href="/admin/events/new">New event</ButtonLink>}
      />
    );
  }

  // Cards for live (published) events only — that is what the day-to-day
  // dashboard is for. Drafts are one line; archived events are history.
  const live = events.filter((e) => e.status === 'published');
  const drafts = events.filter((e) => e.status === 'draft').length;
  // Two queries for all live events, never one per event.
  const [typesByEvent, capacityMap] = await Promise.all([
    ticketTypesService.listForEvents(live.map((e) => e.id)),
    ticketTypesService.capacityForEvents(live.map((e) => e.id)),
  ]);
  const withTypes = live.map((event) => ({ event, types: typesByEvent.get(event.id) ?? [] }));
  const sold = [...capacityMap.values()].reduce((n, c) => n + c.sold, 0);
  const capacity = [...capacityMap.values()].reduce((n, c) => n + c.total, 0);

  const next = events
    .filter((e) => e.status === 'published' && e.startsAt.getTime() > now.getTime())
    .sort((a, b) => a.startsAt.getTime() - b.startsAt.getTime())[0];
  const headline = next
    ? `${formatDhakaLong(now)} (Dhaka) · ${differenceInCalendarDays(next.startsAt, now)} days to ${next.title}`
    : `${formatDhakaLong(now)} (Dhaka)`;

  // B3's numbers, defined as B9 and B12 define them (dashboard.service.ts).
  const summary = await dashboardService.summary();
  const pendingVerification = summary.pendingVerification;
  const ordersToday = summary.today.ordersPlaced;
  const revenueTodayPaisa = summary.today.approvedPaisa;
  const holdsExpiring = summary.holdsExpiringSoon;
  const quiet = quietDay(summary);
  const salesDays =
    next?.registrationOpensAt && next.registrationOpensAt.getTime() <= now.getTime()
      ? differenceInCalendarDays(now, next.registrationOpensAt)
      : null;

  return (
    <div className="flex flex-col gap-4.5">
      <p className="text-[15px] text-muted-foreground">{headline}</p>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          label="Pending verification"
          value={pendingVerification}
          urgent={pendingVerification > 0}
          detail={
            pendingVerification > 0 ? (
              <Link href="/admin/verification" className="font-semibold underline">
                Open queue →
              </Link>
            ) : (
              'All clear'
            )
          }
          detailTone="success"
        />
        <StatCard
          label="Orders today"
          value={<span data-testid="orders-today">{ordersToday}</span>}
          detail={vsYesterday(ordersToday, summary.yesterday.ordersPlaced)}
        />
        <StatCard
          label="Revenue today"
          value={
            <span data-testid="revenue-today">
              <Money paisa={revenueTodayPaisa} />
            </span>
          }
          detail={revenueTodayPaisa > 0 ? 'Verified payments only' : '—'}
        />
        <StatCard
          label="Holds expiring < 2h"
          value={<span data-testid="holds-expiring">{holdsExpiring}</span>}
          detail={
            holdsExpiring > 0 ? (
              <Link href="/admin/orders?status=pending_payment" className="hover:underline">
                Review now →
              </Link>
            ) : (
              '—'
            )
          }
          detailTone="accent"
        />
      </div>

      {live.length === 0 ? (
        <section className="flex flex-col gap-2 rounded-xl border border-border bg-card p-5 shadow-sm">
          <h2 className="text-lg">No live event</h2>
          <p className="text-sm text-muted-foreground">
            {drafts > 0
              ? `${drafts} draft${drafts === 1 ? '' : 's'} waiting — open one and press Publish when it is ready.`
              : 'Create an event and publish it to start taking registrations.'}
          </p>
          <ButtonLink href="/admin/events" variant="secondary" size="sm" className="self-start">
            Go to events
          </ButtonLink>
        </section>
      ) : null}

      {withTypes.map(({ event, types }) => {
        const {
          total,
          sold: eSold,
          held: eHeld,
        } = capacityMap.get(event.id) ?? {
          total: 0,
          sold: 0,
          held: 0,
        };
        return (
          <section
            key={event.id}
            className="flex flex-col gap-4.5 rounded-xl border border-border bg-card p-5 shadow-sm"
            aria-labelledby={`event-${event.id}`}
          >
            <div className="flex flex-col gap-1.5">
              <div className="flex flex-wrap items-center gap-3">
                <h2 id={`event-${event.id}`} className="text-xl">
                  {event.title}
                </h2>
                <StatusChip status={event.status} />
              </div>
              <p className="text-sm text-muted-foreground tabular">
                {formatDhakaLong(event.startsAt)} (Dhaka)
                {event.registrationClosesAt
                  ? ` · closes ${formatDhakaLong(event.registrationClosesAt)}`
                  : ''}
              </p>
            </div>

            {types.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                No ticket types yet — add at least one to publish.
              </p>
            ) : (
              <ul className="flex flex-col gap-3.5">
                {types.map((t) => {
                  const state = ticketTypeSaleState(t, now);
                  const soldOut = t.quantityTotal - t.quantitySold - t.quantityReserved <= 0;
                  return (
                    <li key={t.id} className="flex flex-col gap-1.5 text-sm">
                      <div className="flex flex-wrap items-baseline justify-between gap-2">
                        <span>
                          <span className="font-semibold">{t.name}</span>
                          <span className="text-muted-foreground">
                            {' '}
                            · <Money paisa={t.pricePaisa} />
                            {state === 'window_ended' ? ' · window closed' : ''}
                            {state === 'opens_later' ? ' · not on sale yet' : ''}
                          </span>
                        </span>
                        <span className="text-muted-foreground tabular">
                          {t.quantitySold} / {t.quantityTotal} sold
                          {t.quantityReserved > 0 ? ` · ${t.quantityReserved} held` : ''}
                        </span>
                      </div>
                      <ProgressBar
                        total={t.quantityTotal}
                        sold={t.quantitySold}
                        held={t.quantityReserved}
                        complete={soldOut}
                        label={`${t.name} sales`}
                      />
                    </li>
                  );
                })}
              </ul>
            )}

            <div className="flex flex-wrap items-center gap-6 border-t border-border pt-4 text-sm">
              <span>
                <span className="text-muted-foreground">Sold </span>
                <span className="font-semibold tabular">
                  {eSold} / {total}
                </span>
              </span>
              <span>
                <span className="text-muted-foreground">Revenue </span>
                <span className="font-semibold tabular" data-testid="event-revenue">
                  <Money paisa={summary.revenueByEvent.get(event.id) ?? 0} />
                </span>
              </span>
              <span>
                <span className="text-muted-foreground">Held </span>
                <span className="font-semibold tabular">{eHeld}</span>
              </span>
              <Link
                href={`/admin/events/${event.id}/edit`}
                className="ml-auto font-semibold text-accent-ink hover:underline"
              >
                Open event →
              </Link>
            </div>
          </section>
        );
      })}

      <section
        className="overflow-hidden rounded-xl border border-border bg-card shadow-sm"
        data-testid="recent-orders"
      >
        <div className="flex items-center justify-between border-b border-border px-5 py-4">
          <h2 className="text-lg">Recent orders</h2>
          <Link
            href="/admin/orders"
            className="text-sm font-semibold text-accent-ink hover:underline"
          >
            All orders →
          </Link>
        </div>
        {quiet || summary.recentOrders.length === 0 ? (
          // B3 quiet day: say what is true instead of a table of old news.
          <div
            className="flex flex-col items-center gap-2 px-6 py-12 text-center"
            data-testid="quiet-day"
          >
            <span className="flex size-11 items-center justify-center rounded-full border border-[#bfe0cd] bg-success-tint text-success">
              ✓
            </span>
            <p className="text-[17px] font-semibold">Nothing needs you right now</p>
            <p className="max-w-100 text-sm leading-relaxed text-muted-foreground">
              {salesDays !== null
                ? `Sales have been running for ${salesDays} ${salesDays === 1 ? 'day' : 'days'}. `
                : ''}
              {capacity > 0
                ? `${sold} of ${capacity} tickets are gone and no payments are waiting.`
                : 'Orders appear here once registration opens.'}
            </p>
          </div>
        ) : (
          <>
            <table className="hidden w-full text-sm sm:table">
              <thead>
                <tr className="border-b border-border text-left text-[12px] text-muted-foreground">
                  <th className="px-5 py-2.5 font-medium">Reference</th>
                  <th className="px-3 py-2.5 font-medium">Buyer</th>
                  <th className="px-3 py-2.5 font-medium">Ticket type</th>
                  <th className="px-3 py-2.5 text-right font-medium">Amount</th>
                  <th className="px-3 py-2.5 font-medium">Status</th>
                  <th className="px-5 py-2.5 text-right font-medium">Created</th>
                </tr>
              </thead>
              <tbody>
                {summary.recentOrders.map(({ order, ticketTypeName }) => (
                  <tr
                    key={order.id}
                    className="border-b border-border last:border-0"
                    data-testid="recent-order"
                  >
                    <td className="px-5 py-3">
                      <Link
                        href={`/admin/orders/${order.id}`}
                        className="font-mono font-medium hover:underline"
                      >
                        {order.reference}
                      </Link>
                    </td>
                    <td className="px-3 py-3">
                      <span className="inline-flex items-center gap-2">
                        {order.buyerName}
                        {order.complimentaryReason !== null ? (
                          <Chip tone="warning" size="sm">
                            Comp
                          </Chip>
                        ) : null}
                      </span>
                    </td>
                    <td className="px-3 py-3">
                      {ticketTypeName} × {order.quantity}
                    </td>
                    <td className="px-3 py-3 text-right tabular">
                      <Money paisa={order.totalPaisa} />
                    </td>
                    <td className="px-3 py-3">
                      <StatusChip kind="order" status={order.status} />
                    </td>
                    <td className="px-5 py-3 text-right whitespace-nowrap text-muted-foreground tabular">
                      {formatRelative(order.createdAt, now)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {/* Phone: one stacked row per order. */}
            <ul className="flex flex-col divide-y divide-border sm:hidden">
              {summary.recentOrders.map(({ order, ticketTypeName }) => (
                <li key={order.id}>
                  <Link
                    href={`/admin/orders/${order.id}`}
                    className="flex flex-col gap-1.5 px-5 py-3.5"
                  >
                    <span className="flex items-center justify-between gap-3">
                      <span className="font-mono font-semibold">{order.reference}</span>
                      <StatusChip kind="order" status={order.status} />
                    </span>
                    <span className="flex items-baseline justify-between gap-3 text-[13px] text-muted-foreground">
                      <span>
                        {order.buyerName} · {ticketTypeName} × {order.quantity}
                      </span>
                      <span className="tabular">
                        <Money paisa={order.totalPaisa} /> · {formatRelative(order.createdAt, now)}
                      </span>
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          </>
        )}
      </section>
    </div>
  );
}
