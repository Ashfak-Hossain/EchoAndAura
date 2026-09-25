import type { Metadata } from 'next';
import Image from 'next/image';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { eventsService } from '@/server/container';
import { EventNotFoundError } from '@/server/lib/errors';
import { offerSummary } from '@/server/lib/event-offer';
import { eventPhase } from '@/server/lib/event-phase';
import { MAX_TICKETS_PER_ORDER } from '@/server/lib/order-rules';
import { formatBDT } from '@/server/lib/money';
import { VENUE_PRIVATE_NOTE, publicVenue, publicVenueLine } from '@/server/lib/venue';
import { PhaseChip } from '@/components/public/phase-chip';
import { PresentedBy } from '@/components/public/sponsors/presented-by';
import { RichText } from '@/components/rich-text';
import { REGISTRATION_CLOSES_DAYS_BEFORE } from '@/content/site';
import { getSiteSettings } from '@/lib/settings';
import { getPublicSponsors } from '@/lib/sponsors';
import { buildEventMetadata, siteUrl } from '@/lib/seo';
import { formatDhakaLong, formatDhakaShort } from '@/lib/time';
import { cn } from '@/lib/utils';
import { EventCta } from './cta';
import { CalendarIcon, PinIcon } from '../../home/icons';
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
    // Same from-price rule as the page and the home cards (ADR-032): a share
    // preview must never quote an Early Bird that has ended or sold out.
    fromPricePaisa: offerSummary(ticketTypes, event, new Date()).fromPricePaisa,
    siteUrl: siteUrl(),
  });
}

// A2, all six states from one `eventPhase` value (redesign 2026-09-21):
// a dark title band over the cover, a facts row, the description, and a
// sticky tickets card on desktop / a sticky CTA bar on mobile.
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
  const [settings, sponsors] = await Promise.all([getSiteSettings(), getPublicSponsors()]);
  const facebook = settings.facebookPageUrl;
  // Looked up in the active list the footer already loaded (React-cached, no
  // extra query): a hidden presenter shows nothing; a deleted one is already
  // null (ON DELETE SET NULL).
  const presenter = event.presentingSponsorId
    ? (sponsors.find((s) => s.id === event.presentingSponsorId) ?? null)
    : null;
  const past = phase === 'past';

  const dateLine = `${formatDhakaLong(event.startsAt)} (Dhaka)`;
  // The event came through forPublic: a private venue is already gone.
  const venue = publicVenue(event);
  const venueLine = publicVenueLine(event);
  const mapsHref = venue.mapsQuery
    ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(venue.mapsQuery)}`
    : null;

  const selling = phase === 'open' || phase === 'closing_soon';
  // The same rule as the home page's cards (Canvas 6, decision 5): the
  // from-price counts what can still be bought, and the Early Bird row is
  // highlighted only while it sells.
  const offer = offerSummary(ticketTypes, event, now);

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

  // Rendered twice (mobile inline, desktop sticky); only the desktop copy
  // carries the CTA — the mobile bar at the bottom has its own.
  const ticketsCard = (withCta: boolean) => (
    <section
      aria-labelledby="tickets-heading"
      className="flex flex-col gap-4 rounded-2xl border border-border bg-card p-5 shadow-md lg:p-6 lg:shadow-lg"
    >
      <div className="flex items-baseline justify-between gap-3">
        <h2 id="tickets-heading" className="font-heading text-[20px] font-semibold lg:text-[24px]">
          {phase === 'not_open' ? 'Prices' : 'Tickets'}
        </h2>
        <span className="text-[13px] text-muted-foreground">
          One type per order · max {MAX_TICKETS_PER_ORDER}
        </span>
      </div>
      <TicketList
        ticketTypes={ticketTypes}
        phase={phase}
        now={now}
        compact
        highlightId={offer.highlightId}
      />
      {withCta ? <div className="flex flex-col gap-2">{cta}</div> : null}
      <p className="flex flex-wrap justify-center gap-x-4 gap-y-1 border-t border-border pt-3 text-center text-[12px] text-muted-foreground">
        <span>✓ Named tickets</span>
        <span>✓ bKash</span>
        <span>✓ Checked by a person</span>
      </p>
    </section>
  );

  return (
    <article className="flex flex-1 flex-col" data-phase={phase}>
      {/* Title band: the cover as a darkened backdrop on desktop, on top on mobile */}
      <section className={cn('relative overflow-hidden bg-[#14120f] text-background')}>
        <div
          className={cn('relative aspect-16/10 w-full bg-[#1a2a20] lg:hidden', past && 'grayscale')}
        >
          {coverUrl ? (
            // Both covers span the viewport: one `sizes`, so one srcset,
            // so the browser picks the same file for both and fetches it
            // once, although one of the two is display:none (ADR-033).
            // Each is the largest paint at its width, so neither is lazy.
            <Image
              src={coverUrl}
              alt=""
              width={1200}
              height={630}
              sizes="100vw"
              loading="eager"
              fetchPriority="high"
              className="size-full object-cover"
              data-testid="event-cover-mobile"
            />
          ) : null}
        </div>
        <div aria-hidden="true" className="absolute inset-0 hidden lg:block">
          {coverUrl ? (
            <Image
              src={coverUrl}
              alt=""
              width={1200}
              height={630}
              sizes="100vw"
              loading="eager"
              fetchPriority="high"
              className={cn('size-full object-cover opacity-90', past && 'grayscale')}
              data-testid="event-cover"
            />
          ) : (
            <div className="size-full bg-[radial-gradient(ellipse_at_65%_45%,#3b5a44_0%,#1a2a20_40%,#0e1511_100%)]" />
          )}
          <div className="absolute inset-0 bg-[linear-gradient(90deg,rgb(20_18_15/0.96)_0%,rgb(20_18_15/0.85)_45%,rgb(20_18_15/0.25)_100%)]" />
        </div>
        <div className="relative mx-auto flex w-full max-w-360 flex-col justify-end gap-3 px-4 pt-5 pb-6 lg:min-h-120 lg:max-w-360 lg:gap-4 lg:px-16 lg:py-12">
          <Link
            href={past ? '/archive' : '/events'}
            className="text-sm text-[#a8a29a] hover:text-background"
          >
            {past ? '← Past events' : '← All events'}
          </Link>
          <div className="flex flex-wrap items-center gap-3">
            <PhaseChip
              phase={phase}
              registrationOpensAt={event.registrationOpensAt}
              earlyBirdOnSale={offer.earlyBirdOnSale}
              variant="card"
              size="sm"
            />
            {selling && event.registrationClosesAt ? (
              <span className="text-[12px] tracking-[0.08em] text-[#c9c3b7] uppercase tabular">
                closes {formatDhakaShort(event.registrationClosesAt)}
              </span>
            ) : null}
          </div>
          <h1 className="max-w-190 font-heading text-[34px] leading-[1.05] font-extrabold tracking-tight text-pretty lg:text-[56px] lg:leading-[1.02]">
            {event.title}
          </h1>
          <div className="flex flex-col gap-1.5 text-[15px] text-[#e6e1d6] lg:flex-row lg:flex-wrap lg:gap-7 lg:text-[17px]">
            <p className="flex items-center gap-2 tabular">
              <CalendarIcon className="shrink-0" />
              {past ? `Happened ${dateLine}` : dateLine}
            </p>
            {venueLine ? (
              <p className="flex items-center gap-2" data-testid="event-venue-line">
                <PinIcon className="shrink-0" />
                {venueLine}
              </p>
            ) : null}
          </div>
          {presenter ? <PresentedBy sponsor={presenter} /> : null}
        </div>
      </section>

      <div className="mx-auto w-full max-w-360 px-4 py-6 lg:grid lg:grid-cols-12 lg:items-start lg:gap-x-6 lg:px-16 lg:py-12">
        {/* Main column */}
        <div className="flex min-w-0 flex-col gap-7 lg:col-span-7 lg:gap-10">
          <PhaseNotice
            phase={phase}
            registrationOpensAt={event.registrationOpensAt}
            registrationClosesAt={event.registrationClosesAt}
            now={now}
          />

          {/* Facts row */}
          <dl className="grid grid-cols-3 gap-2 lg:gap-4">
            <div className="flex flex-col gap-1 rounded-xl border border-border bg-card p-3 lg:gap-1.5 lg:p-5">
              <dt className="text-[10px] font-medium tracking-[0.12em] text-muted-foreground uppercase lg:text-xs">
                {past ? 'Was' : 'When'}
              </dt>
              <dd className="font-heading text-[15px] font-semibold tabular lg:text-[20px]">
                {formatDhakaShort(event.startsAt)}
              </dd>
              {event.endsAt ? (
                <dd className="hidden text-[13px] text-muted-foreground tabular lg:block">
                  ends ~{formatDhakaShort(event.endsAt)}
                </dd>
              ) : null}
            </div>
            <div className="flex flex-col gap-1 rounded-xl border border-border bg-card p-3 lg:gap-1.5 lg:p-5">
              <dt className="text-[10px] font-medium tracking-[0.12em] text-muted-foreground uppercase lg:text-xs">
                Venue
              </dt>
              <dd
                className="line-clamp-2 font-heading text-[15px] font-semibold text-pretty lg:text-[20px]"
                data-testid="event-venue"
              >
                {venue.text ?? (venue.isPrivate ? 'Private' : 'To be announced')}
              </dd>
              {venue.isPrivate ? (
                <dd className="text-[13px] text-muted-foreground" data-testid="event-venue-note">
                  {VENUE_PRIVATE_NOTE}
                </dd>
              ) : null}
              {mapsHref ? (
                <dd className="text-[13px]">
                  <a
                    href={mapsHref}
                    target="_blank"
                    rel="noreferrer"
                    className="text-accent-ink underline underline-offset-2"
                  >
                    <span className="lg:hidden">Maps ↗</span>
                    <span className="hidden lg:inline">Open in Maps ↗</span>
                  </a>
                </dd>
              ) : null}
            </div>
            <div className="flex flex-col gap-1 rounded-xl border border-border bg-card p-3 lg:gap-1.5 lg:p-5">
              <dt className="text-[10px] font-medium tracking-[0.12em] text-muted-foreground uppercase lg:text-xs">
                Entry
              </dt>
              <dd className="font-heading text-[15px] font-semibold lg:text-[20px]">QR ticket</dd>
              <dd className="hidden text-[13px] text-muted-foreground lg:block">
                Scanned at the door · name + code works too
              </dd>
            </div>
          </dl>

          {/* Mobile tickets card; on desktop the sticky column carries it. */}
          <div className="lg:hidden">{ticketsCard(false)}</div>

          {event.description ? (
            <section className="flex flex-col gap-3 lg:gap-4">
              <h2 className="font-heading text-[24px] font-semibold tracking-[-0.01em] lg:text-[30px]">
                About the night
              </h2>
              <RichText
                description={event.description}
                className="max-w-160 text-[16px] text-pretty text-[#2b2925] lg:text-[17px]"
              />
            </section>
          ) : null}

          {!past ? (
            <section className="flex flex-col gap-2.5 rounded-xl bg-secondary p-4.5 lg:p-6">
              <h2 className="font-heading text-[17px] font-semibold lg:text-[20px]">
                Good to know
              </h2>
              <ul className="list-disc space-y-1 pl-5 text-[14px] leading-relaxed text-[#4a4640] lg:text-[15px]">
                <li>
                  Tickets are named. You can change the name on a ticket until registration closes,{' '}
                  {REGISTRATION_CLOSES_DAYS_BEFORE} days before the show.
                </li>
                <li>
                  Pay by bKash after registering; a person checks it, {settings.verificationPromise}
                  .
                </li>
                <li>No refunds through the app — see the refund policy for cancellations.</li>
              </ul>
            </section>
          ) : null}

          {!past ? <ShareRow url={pageUrl} title={event.title} /> : null}
        </div>

        {/* Desktop sticky tickets card */}
        <aside className="sticky top-24 hidden lg:col-span-4 lg:col-start-9 lg:block">
          {ticketsCard(true)}
        </aside>
      </div>

      {/* Mobile sticky CTA bar */}
      <div className="sticky bottom-0 mt-auto flex items-center gap-3 border-t border-border bg-background/95 px-4 pt-3 pb-5 shadow-[0_-4px_12px_rgb(28_26_23/0.08)] backdrop-blur lg:hidden">
        {offer.fromPricePaisa !== null && selling ? (
          <div className="flex shrink-0 flex-col">
            <span className="text-[15px] font-bold tabular">
              from {formatBDT(offer.fromPricePaisa)}
            </span>
            {event.registrationClosesAt ? (
              <span className="text-[12px] text-muted-foreground tabular">
                closes {formatDhakaShort(event.registrationClosesAt)}
              </span>
            ) : null}
          </div>
        ) : null}
        <div className="flex flex-1 flex-col gap-2">{cta}</div>
      </div>
    </article>
  );
}
