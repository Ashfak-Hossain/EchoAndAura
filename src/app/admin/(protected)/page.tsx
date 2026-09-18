import type { Metadata } from 'next';
import Link from 'next/link';
import { differenceInCalendarDays } from 'date-fns';
import { eventsService, ticketTypesService } from '@/server/container';
import { ButtonLink } from '@/components/button-link';
import { EmptyState } from '@/components/empty-state';
import { Money } from '@/components/money';
import { PageHeader } from '@/components/page-header';
import { ProgressBar } from '@/components/progress-bar';
import { StatCard } from '@/components/stat-card';
import { StatusChip } from '@/components/status-chip';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { formatDhakaLong } from '@/lib/time';

export const metadata: Metadata = { title: 'Dashboard' };

// B3 with the data that exists today: events and their ticket types. Order
// and revenue cards arrive with Phase 3/4 — zero states say what is true
// rather than showing a number Raj might think is broken.
export default async function AdminDashboardPage() {
  const now = new Date();
  const events = await eventsService.listEvents();
  const live = events.filter((e) => e.status !== 'archived');

  const withTypes = await Promise.all(
    live.map(async (event) => ({
      event,
      types: await ticketTypesService.listForEvent(event.id),
    })),
  );

  const published = events.filter((e) => e.status === 'published').length;
  const drafts = events.filter((e) => e.status === 'draft').length;
  const allTypes = withTypes.flatMap((x) => x.types);
  const sold = allTypes.reduce((n, t) => n + t.quantitySold, 0);
  const held = allTypes.reduce((n, t) => n + t.quantityReserved, 0);

  const next = events
    .filter((e) => e.status === 'published' && e.startsAt.getTime() > now.getTime())
    .sort((a, b) => a.startsAt.getTime() - b.startsAt.getTime())[0];
  const headline = next
    ? `${formatDhakaLong(now)} (Dhaka) · ${differenceInCalendarDays(next.startsAt, now)} days to ${next.title}`
    : `${formatDhakaLong(now)} (Dhaka)`;

  if (events.length === 0) {
    return (
      <div className="flex flex-col gap-6">
        <PageHeader title="Dashboard" />
        <EmptyState
          title="Create your first event"
          description="Add the date, venue and ticket types. Nothing is public until you press Publish."
          action={<ButtonLink href="/admin/events/new">New event</ButtonLink>}
        />
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <PageHeader title="Dashboard" subtitle={headline} />

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          label="Published events"
          value={published}
          detail={published === 0 ? 'Nothing is public yet' : 'Taking registrations'}
        />
        <StatCard
          label="Draft events"
          value={drafts}
          detail={drafts === 0 ? '—' : 'Not visible to buyers'}
        />
        <StatCard label="Tickets sold" value={sold} detail="Across live events" />
        <StatCard
          label="Tickets held"
          value={held}
          detail={held === 0 ? 'No pending holds' : 'Awaiting payment'}
        />
      </div>

      {withTypes.map(({ event, types }) => {
        const total = types.reduce((n, t) => n + t.quantityTotal, 0);
        const eSold = types.reduce((n, t) => n + t.quantitySold, 0);
        const eHeld = types.reduce((n, t) => n + t.quantityReserved, 0);
        return (
          <Card key={event.id}>
            <CardHeader>
              <div className="flex flex-wrap items-center gap-3">
                <CardTitle className="text-xl">{event.title}</CardTitle>
                <StatusChip status={event.status} />
              </div>
              <p className="text-sm text-muted-foreground">
                {formatDhakaLong(event.startsAt)} (Dhaka)
                {event.registrationClosesAt
                  ? ` · closes ${formatDhakaLong(event.registrationClosesAt)}`
                  : ''}
              </p>
            </CardHeader>
            <CardContent className="flex flex-col gap-4">
              {types.length === 0 ? (
                <p className="text-sm text-muted-foreground">No ticket types yet.</p>
              ) : (
                <ul className="flex flex-col gap-3">
                  {types.map((t) => (
                    <li key={t.id} className="flex flex-col gap-1.5">
                      <div className="flex flex-wrap items-baseline justify-between gap-2 text-sm">
                        <span>
                          <span className="font-medium">{t.name}</span>
                          <span className="text-muted-foreground">
                            {' '}
                            · <Money paisa={t.pricePaisa} />
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
                        label={`${t.name} sales`}
                      />
                    </li>
                  ))}
                </ul>
              )}
              <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border pt-4 text-sm">
                <div className="flex gap-6">
                  <span>
                    <span className="text-muted-foreground">Sold </span>
                    <span className="font-medium tabular">
                      {eSold} / {total}
                    </span>
                  </span>
                  <span>
                    <span className="text-muted-foreground">Held </span>
                    <span className="font-medium tabular">{eHeld}</span>
                  </span>
                </div>
                <Link
                  href={`/admin/events/${event.id}/edit`}
                  className="font-medium hover:underline"
                >
                  Open event →
                </Link>
              </div>
            </CardContent>
          </Card>
        );
      })}

      <p className="text-sm text-muted-foreground">
        Recent orders appear here once registration opens (Phase 3).
      </p>
    </div>
  );
}
