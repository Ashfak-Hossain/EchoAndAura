import { ButtonLink } from '@/components/button-link';

/**
 * A1 dormant state — what the site shows most of the year. A brand
 * statement on charcoal with one action, never an apology or an empty list.
 */
export function NoLiveEvent({ facebookUrl }: { facebookUrl: string | null }) {
  return (
    <section
      aria-labelledby="dormant-title"
      data-testid="home-dormant"
      className="bg-foreground text-background"
    >
      <div className="mx-auto flex w-full max-w-290 flex-col gap-6 px-4 py-12 lg:grid lg:grid-cols-[minmax(0,7fr)_minmax(0,5fr)] lg:items-end lg:gap-16 lg:px-12 lg:py-20">
        <div className="flex flex-col gap-4">
          <p className="font-mono text-xs font-medium tracking-widest text-[#a8a29a] uppercase">
            Live events · Dhaka
          </p>
          <h1
            id="dormant-title"
            className="font-heading text-[34px] leading-[1.05] font-bold tracking-[-0.02em] text-pretty lg:text-[52px] lg:leading-[1.02] lg:tracking-tight"
          >
            Small rooms, real sound, four acts a night.
          </h1>
          <p className="max-w-[52ch] text-[15px] leading-relaxed text-pretty text-[#c9c3b7] lg:text-[17px]">
            echoandaura puts on a handful of shows a year in Dhaka and Chattogram. Tickets are
            named, paid by bKash, and checked by a person before they are issued.
          </p>
        </div>
        <div className="flex flex-col gap-3 rounded-xl border border-[#33302a] bg-[#26231f] p-5">
          <p className="text-[17px] font-semibold">Next event announced soon</p>
          <p className="text-sm leading-relaxed text-pretty text-[#c9c3b7]">
            Tickets go on sale 20 days before the date. Facebook is where it goes up first.
          </p>
          {facebookUrl ? (
            <ButtonLink
              href={facebookUrl}
              target="_blank"
              rel="noreferrer"
              variant="cta"
              className="mt-1 w-full sm:w-auto"
            >
              Follow on Facebook
            </ButtonLink>
          ) : null}
        </div>
      </div>
    </section>
  );
}
