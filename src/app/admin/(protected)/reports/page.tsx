import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ChevronDown, Download } from 'lucide-react';
import { reportsService } from '@/server/container';
import { EventNotFoundError } from '@/server/lib/errors';
import { defaultReportEvent, dhakaDaysUntil, inDays } from '@/server/lib/sales-report';
import { PrintButton } from '@/components/admin/print-button';
import { ButtonLink } from '@/components/button-link';
import { EmptyState } from '@/components/empty-state';
import { PageHeader } from '@/components/page-header';
import { StatusChip } from '@/components/status-chip';
import { formatDhaka, formatDhakaLong } from '@/lib/time';
import { reportsQuerySchema } from '@/lib/validation/reports';
import { EventsOverview } from './events-overview';
import { FunnelCard } from './funnel-card';
import { KpiRow } from './kpi-row';
import { ReportToolbar } from './report-toolbar';
import { SalesOverTime } from './sales-over-time';
import { SpeedCard } from './speed-card';
import { TicketTypeTable } from './ticket-type-table';
import { WhenPeopleRegister } from './when-people-register';

export const metadata: Metadata = { title: 'Reports' };
export const dynamic = 'force-dynamic';

interface Props {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

/** The overview lists the newest events; the rest are one link away. A single organizer has tens of events, not hundreds. */
const OVERVIEW_LIMIT = 12;

const exportLink =
  'flex items-center gap-2 px-3 py-2 text-[13px] hover:bg-secondary first:rounded-t-lg last:rounded-b-lg';

// B12: the event and the range come from the URL; the service returns one
// typed report and the cross-event overview. Thin: Zod → service → sections.
export default async function ReportsPage({ searchParams }: Props) {
  const raw = await searchParams;
  const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);
  const input = reportsQuerySchema.parse({ event: first(raw.event), range: first(raw.range) });

  const overview = await reportsService.overview();
  if (overview.length === 0) {
    return (
      <EmptyState
        title="No events to report on"
        description="Reports fill in once an event exists and its first payment is approved."
        action={<ButtonLink href="/admin/events/new">New event</ButtonLink>}
      />
    );
  }
  const events = overview.map((r) => r.event);
  const eventId = input.event ?? defaultReportEvent(events, new Date())?.id;
  if (!eventId) notFound();

  let report;
  try {
    report = await reportsService.salesReport(eventId, input.range);
  } catch (err: unknown) {
    if (err instanceof EventNotFoundError) notFound();
    throw err;
  }
  const { event } = report;
  const now = report.generatedAt;
  const closes = event.registrationClosesAt;
  const registration =
    event.startsAt.getTime() < now.getTime()
      ? 'event over'
      : closes && closes.getTime() > now.getTime()
        ? `registration closes ${inDays(dhakaDaysUntil(closes, now))}`
        : closes
          ? 'registration closed'
          : null;
  // Newest first, the open event always included.
  const overviewRows = overview.slice(0, OVERVIEW_LIMIT);
  if (!overviewRows.some((r) => r.event.id === event.id)) {
    const current = overview.find((r) => r.event.id === event.id);
    if (current) overviewRows.push(current);
  }
  const range = report.window.range;
  const csv = (section: string) =>
    `/admin/reports/export.csv?event=${event.id}&range=${range}&section=${section}`;

  return (
    <div className="flex flex-col gap-6">
      <div className="print:hidden">
        <PageHeader
          title="Reports"
          badge={<StatusChip status={event.status} />}
          subtitle={
            <span data-testid="report-subtitle">
              {event.title} · {formatDhakaLong(event.startsAt)} (Dhaka)
              {registration ? ` · ${registration}` : ''}
            </span>
          }
          actions={
            <>
              <details className="relative">
                <summary className="inline-flex h-9 cursor-pointer list-none items-center gap-1.5 rounded-lg border border-border-strong bg-card px-3.5 text-[13px] font-semibold hover:bg-secondary [&::-webkit-details-marker]:hidden">
                  <Download className="size-3.5" aria-hidden="true" />
                  Export CSV
                  <ChevronDown className="size-3.5" aria-hidden="true" />
                </summary>
                <div className="absolute right-0 z-10 mt-1 w-56 rounded-lg border border-border bg-card py-0 shadow-md">
                  <Link href={csv('summary')} prefetch={false} className={exportLink}>
                    Ticket types (summary)
                  </Link>
                  <Link href={csv('daily')} prefetch={false} className={exportLink}>
                    Daily sales (this period)
                  </Link>
                  <Link href={csv('overview')} prefetch={false} className={exportLink}>
                    All events
                  </Link>
                </div>
              </details>
              <PrintButton label="Print report" />
            </>
          }
        />
      </div>

      {/* Print-only title: the shell and the toolbar do not print. */}
      <div className="hidden print:block">
        <h1 className="text-2xl">{event.title} — sales report</h1>
        <p className="text-sm text-muted-foreground">
          {formatDhakaLong(event.startsAt)} (Dhaka) · generated {formatDhaka(now)} ·{' '}
          {range === 'all' ? 'all time' : `last ${report.window.days} days`}
        </p>
      </div>

      {/* Sticks under the shell header so the event/range are always one tap away on a long page. */}
      <div className="sticky top-0 z-10 -mx-4 bg-background/95 px-4 py-2 backdrop-blur lg:-mx-6 lg:px-6 print:hidden">
        <ReportToolbar
          events={events.map((e) => ({ id: e.id, title: e.title }))}
          eventId={event.id}
          range={range}
        />
      </div>

      <div className="print-colors flex flex-col gap-6">
        <KpiRow report={report} />

        {report.noSalesYet ? (
          <EmptyState
            icon="—"
            title="No sales to report yet"
            description={
              <>
                Numbers appear once the first payment is approved.
                {event.registrationOpensAt
                  ? ` Registration ${event.registrationOpensAt.getTime() > now.getTime() ? 'opens' : 'opened'} ${formatDhakaLong(event.registrationOpensAt)} (Dhaka).`
                  : ''}
              </>
            }
          />
        ) : (
          <>
            <SalesOverTime report={report} />
            <div className="grid gap-6 lg:grid-cols-2 print:grid-cols-2">
              <FunnelCard report={report} />
              <SpeedCard report={report} />
            </div>
          </>
        )}

        <TicketTypeTable report={report} />

        {report.noSalesYet ? null : <WhenPeopleRegister report={report} />}

        <EventsOverview
          rows={overviewRows}
          more={overview.length - overviewRows.length}
          currentId={event.id}
          range={range}
        />
      </div>
    </div>
  );
}
