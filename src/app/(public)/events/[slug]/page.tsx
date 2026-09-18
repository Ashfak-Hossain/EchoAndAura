import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { eventsService } from '@/server/container';
import { EventNotFoundError } from '@/server/lib/errors';
import { eventPhase } from '@/server/lib/event-phase';
import { RichText } from '@/components/rich-text';
import { facebookPageUrl } from '@/lib/env.public';
import { buildEventMetadata, siteUrl } from '@/lib/seo';
import { formatDhakaLong } from '@/lib/time';
import { cn } from '@/lib/utils';
import { EventCta } from './cta';
import { PhaseNotice } from './phase-notice';
import { ShareRow } from './share-row';
import { TicketList } from './ticket-list';

interface Props {
  params: Promise<{ slug: string }>;
}

async function load(slug: string) {
  try {
    return await eventsService.getPublicEvent(slug);
  } catch (err: unknown) {
    if (err instanceof EventNotFoundError) notFound();
    throw err;
  }
}

/** Open Graph from the server HTML — this is what Facebook reads. */
export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params;
  const { event, ticketTypes } = await load(slug);
  return buildEventMetadata({
    event,
    coverUrl: eventsService.coverImageUrl(event),
    fromPricePaisa: ticketTypes.length ? Math.min(...ticketTypes.map((t) => t.pricePaisa)) : null,
    siteUrl: siteUrl(),
  });
}

// A2, all six states from one `eventPhase` value. Mobile: single column with
// a sticky CTA bar. Desktop (lg): content 1160 with a 380px sticky panel.
export default async function PublicEventPage({ params }: Props) {
  const { slug } = await params;
  const { event, ticketTypes } = await load(slug);
  const now = new Date();

  const availableTotal = ticketTypes.reduce(
    (n, t) => n + Math.max(0, t.quantityTotal - t.quantitySold - t.quantityReserved),
    0,
  );
  const phase = eventPhase({ event, availableTotal, now });
  const coverUrl = eventsService.coverImageUrl(event);
  const pageUrl = `${siteUrl()}/events/${event.slug}`;
  const facebook = facebookPageUrl();
  const past = phase === 'past';

  const dateLine = `${formatDhakaLong(event.startsAt)} (Dhaka)`;
  const mapsHref = event.venue
    ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(event.venue)}`
    : null;

  const cta = (
    <EventCta
      phase={phase}
      slug={event.slug}
      registrationOpensAt={event.registrationOpensAt}
      registrationClosesAt={event.registrationClosesAt}
      availableTotal={availableTotal}
      facebookUrl={facebook}
      now={now}
    />
  );

  return (
    <article className="flex flex-1 flex-col" data-phase={phase}>
      <div className="mx-auto w-full max-w-290 lg:grid lg:grid-cols-[minmax(0,1fr)_380px] lg:items-start lg:gap-12 lg:px-12 lg:py-10">
        {/* Main column */}
        <div className="flex min-w-0 flex-col">
          <div
            className={cn(
              'aspect-video w-full bg-secondary lg:overflow-hidden lg:rounded-2xl',
              past && 'grayscale',
            )}
          >
            {coverUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={coverUrl}
                alt=""
                className="size-full object-cover"
                data-testid="event-cover"
              />
            ) : null}
          </div>

          <div className="flex flex-col gap-4 px-4 py-4.5 lg:gap-7 lg:px-0 lg:py-7">
            <PhaseNotice
              phase={phase}
              registrationOpensAt={event.registrationOpensAt}
              registrationClosesAt={event.registrationClosesAt}
              now={now}
            />

            <header className="flex flex-col gap-2 lg:gap-3">
              <h1 className="font-heading text-[28px] leading-[1.15] font-bold tracking-[-0.02em] text-pretty lg:text-5xl lg:leading-[1.02] lg:tracking-tight">
                {event.title}
              </h1>
              <p className="text-[15px] leading-normal text-[#4a4640] tabular lg:text-lg">
                {past ? `Happened ${dateLine}` : dateLine}
              </p>
              {event.venue ? (
                <p className="text-[15px] leading-normal text-[#4a4640] lg:text-lg">
                  {event.venue}
                  {mapsHref ? (
                    <>
                      {' · '}
                      <a href={mapsHref} target="_blank" rel="noreferrer" className="underline">
                        <span className="lg:hidden">map</span>
                        <span className="hidden lg:inline">open in maps</span>
                      </a>
                    </>
                  ) : null}
                </p>
              ) : null}
            </header>

            {!past ? <ShareRow url={pageUrl} title={event.title} /> : null}

            <RichText
              description={event.description}
              className="max-w-160 text-[15px] text-pretty text-[#4a4640] lg:text-[17px]"
            />

            {/* Mobile ticket list; on desktop the panel carries it. */}
            <section className="flex flex-col gap-2.5 lg:hidden" aria-labelledby="tickets-heading">
              <h2
                id="tickets-heading"
                className="font-sans text-xs font-medium tracking-widest text-muted-foreground uppercase"
              >
                {phase === 'not_open' ? 'Prices' : 'Tickets'}
              </h2>
              <TicketList ticketTypes={ticketTypes} phase={phase} now={now} />
            </section>
          </div>
        </div>

        {/* Desktop sticky panel */}
        <aside className="sticky top-6 hidden flex-col gap-4 rounded-2xl border border-border-strong bg-card p-6 shadow-md lg:flex">
          <h2 className="text-xl">{phase === 'not_open' ? 'Prices' : 'Tickets'}</h2>
          <TicketList ticketTypes={ticketTypes} phase={phase} now={now} compact />
          <div className="flex flex-col gap-2">{cta}</div>
        </aside>
      </div>

      {/* Mobile sticky CTA bar */}
      <div className="sticky bottom-0 mt-auto flex flex-col gap-2 border-t border-border bg-card px-4 pt-3 pb-5 shadow-[0_-4px_12px_rgb(28_26_23/0.06)] lg:hidden">
        {cta}
      </div>
    </article>
  );
}
