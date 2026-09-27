import { cn } from '@/lib/utils';
import { FacebookIcon } from './icons';
import { homeColumn, homeSection, sectionTitle } from './section-heading';

/**
 * N9 follow block: where the next show is announced. The page renders it
 * only with a Facebook URL and a show on the hero — the dormant hero
 * already leads with "Follow on Facebook".
 */
export function FollowBlock({ facebookUrl }: { facebookUrl: string }) {
  return (
    <section aria-labelledby="follow-heading" className={homeSection}>
      <div
        className={cn(
          homeColumn,
          'flex flex-col justify-between gap-6 rounded-[16px] border border-border bg-secondary p-6 lg:flex-row lg:items-center lg:p-12',
        )}
      >
        <div className="flex max-w-160 flex-col gap-2">
          <h2 id="follow-heading" className={sectionTitle}>
            Follow for new shows
          </h2>
          <p className="text-base leading-[1.6] text-pretty text-muted-foreground lg:text-lg">
            New nights are posted on the echoandaura Facebook page. There is no mailing list to
            join.
          </p>
        </div>
        <a
          href={facebookUrl}
          target="_blank"
          rel="noreferrer"
          className="inline-flex h-13 shrink-0 items-center justify-center gap-2 rounded-[8px] border border-foreground bg-foreground px-6 text-base font-semibold text-background hover:bg-[#33302a]"
        >
          <FacebookIcon />
          Follow on Facebook
          <span className="sr-only"> (opens in a new tab)</span>
        </a>
      </div>
    </section>
  );
}
