import type { Metadata } from 'next';
import Link from 'next/link';
import { differenceInCalendarDays } from 'date-fns';
import { eventsService, ordersService, ticketTypesService } from '@/server/container';
import { ButtonLink } from '@/components/button-link';
import { EmptyState } from '@/components/empty-state';
import { Money } from '@/components/money';
import { ProgressBar } from '@/components/progress-bar';
import { StatCard } from '@/components/stat-card';
import { StatusChip } from '@/components/status-chip';
import { ticketTypeSaleState } from '@/lib/status-labels';
import { formatDhakaLong } from '@/lib/time';

export const metadata: Metadata = { title: 'Dashboard' };

/**
 * B3, laid out as designed. The StatCard row is ordered by urgency. Order and
 * payment numbers (pending verification, orders/revenue today, expiring
 * holds, recent orders) come from Phase 3/4; until then the cards show the
 * design's zero states, which say what is true rather than a bare 0.
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
  const withTypes = await Promise.all(
    live.map(async (event) => ({ event, types: await ticketTypesService.listForEvent(event.id) })),
  );
  const capacityMap = await ticketTypesService.capacityForEvents(live.map((e) => e.id));
  const sold = [...capacityMap.values()].reduce((n, c) => n + c.sold, 0);
  const capacity = [...capacityMap.values()].reduce((n, c) => n + c.total, 0);

  const next = events
    .filter((e) => e.status === 'published' && e.startsAt.getTime() > now.getTime())
    .sort((a, b) => a.startsAt.getTime() - b.startsAt.getTime())[0];
  const headline = next
    ? `${formatDhakaLong(now)} (Dhaka) · ${differenceInCalendarDays(next.startsAt, now)} days to ${next.title}`
    : `${formatDhakaLong(now)} (Dhaka)`;

  // Phase 3/4 wire these to orders; the zero states are the design's own copy.
  const pendingVerification = await ordersService.countPendingVerification();
  const ordersToday = 0;
  const revenueTodayPaisa = 0;
  const holdsExpiring = 0;

  return (
    <div className="flex flex-col gap-[18px]">
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
          value={ordersToday}
          detail={ordersToday > 0 ? undefined : 'Quiet so far'}
        />
        <StatCard
          label="Revenue today"
          value={<Money paisa={revenueTodayPaisa} />}
          detail={revenueTodayPaisa > 0 ? 'Verified payments only' : '—'}
        />
        <StatCard
          label="Holds expiring < 2h"
          value={holdsExpiring}
          detail={holdsExpiring > 0 ? 'Review now →' : '—'}
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
            className="flex flex-col gap-[18px] rounded-xl border border-border bg-card p-5 shadow-sm"
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
                <span className="text-muted-foreground">—</span>
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

      <section className="overflow-hidden rounded-xl border border-border bg-card shadow-sm">
        <div className="flex items-center justify-between border-b border-border px-5 py-4">
          <h2 className="text-lg">Recent orders</h2>
          <span className="text-sm font-semibold text-[#a8a29a]">All orders →</span>
        </div>
        {/* B3 quiet-day empty state, until orders exist (Phase 3). */}
        <div className="flex flex-col items-center gap-2 px-6 py-12 text-center">
          <span className="flex size-11 items-center justify-center rounded-full border border-[#bfe0cd] bg-success-tint text-success">
            ✓
          </span>
          <p className="text-[17px] font-semibold">Nothing needs you right now</p>
          <p className="max-w-[400px] text-sm leading-relaxed text-muted-foreground">
            {capacity > 0
              ? `${sold} of ${capacity} tickets are gone and no payments are waiting. Orders appear here once registration opens.`
              : 'Orders appear here once registration opens.'}
          </p>
        </div>
      </section>
    </div>
  );
}
