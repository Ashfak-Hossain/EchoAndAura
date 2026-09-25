import Link from 'next/link';
import type { HomeEvent } from '@/server/services/events.service';
import { CoverPlaceholder, bandCover } from './cover-placeholder';
import { FacebookIcon } from './icons';
import { monthAndCity } from './past-strip';

/**
 * The home page between shows (Canvas 6, H2 dormant) — most of the year.
 * Same band and grid as the hero, but it points at what exists: Facebook,
 * where the next show goes up first, and the last show, as proof the nights
 * are real. With no past show either, the brand mark holds the cover's
 * place.
 */
export function DormantHero({
  lastShow,
  facebookUrl,
}: {
  /** The most recent show that has started (`past[0]`), or null. */
  lastShow: HomeEvent | null;
  facebookUrl: string | null;
}) {
  return (
    <section
      aria-labelledby="dormant-title"
      data-testid="home-dormant"
      className="bg-foreground text-[#e6e1d6]"
    >
      <div className="mx-auto grid max-w-360 grid-cols-1 items-center gap-6 px-4 py-12 lg:grid-cols-[minmax(0,5fr)_minmax(0,6fr)] lg:gap-16 lg:px-16 lg:py-24">
        <div className="flex min-w-0 flex-col gap-6">
          <p className="font-mono text-xs font-medium tracking-[0.14em] text-[#a8a29a] uppercase">
            Between shows
          </p>
          <h1
            id="dormant-title"
            className="text-[30px] leading-[1.05] font-bold tracking-[-0.025em] text-balance text-[#fbfaf8] lg:text-[48px]"
          >
            No shows on sale right now.
          </h1>
          <p className="max-w-130 text-base leading-[1.6] text-pretty lg:text-lg">
            echoandaura puts on a handful of small live-music nights a year in Dhaka and Chattogram.
            New shows are posted on Facebook.
          </p>
          {facebookUrl || lastShow ? (
            <div className="flex flex-wrap items-center gap-2">
              {facebookUrl ? (
                <a
                  href={facebookUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex h-13 items-center gap-2 rounded-[8px] border border-[#fbfaf8] bg-[#fbfaf8] px-6 text-base font-semibold text-foreground hover:bg-[#e6e1d6]"
                >
                  <FacebookIcon />
                  Follow on Facebook
                  <span className="sr-only"> (opens in a new tab)</span>
                </a>
              ) : null}
              {lastShow ? (
                // Alone (no Facebook URL), its text lines up with the blurb.
                <Link
                  href="/archive"
                  className="inline-flex h-13 items-center rounded-[8px] px-4 text-base font-semibold text-[#fbfaf8] first:-ml-4 hover:bg-wash"
                >
                  See past events →
                </Link>
              ) : null}
            </div>
          ) : null}
        </div>

        {/* Cover first on phones, right column from lg (as in the hero). */}
        {lastShow ? (
          <Link
            href={`/events/${lastShow.event.slug}`}
            className="group order-first flex min-w-0 flex-col gap-3 rounded-lg lg:order-none"
          >
            {lastShow.coverUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={lastShow.coverUrl}
                alt=""
                width={1200}
                height={630}
                fetchPriority="high"
                className={`${bandCover} object-cover`}
              />
            ) : (
              <CoverPlaceholder />
            )}
            <span className="text-sm text-[#a8a29a] tabular">
              Last show · {monthAndCity(lastShow.event)}
            </span>
            <span className="font-heading text-xl font-semibold text-[#fbfaf8] group-hover:underline">
              {lastShow.event.title}
            </span>
          </Link>
        ) : (
          <CoverPlaceholder className="order-first lg:order-none" />
        )}
      </div>
    </section>
  );
}
