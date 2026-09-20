import { formatInTimeZone } from 'date-fns-tz';
import { DHAKA_TZ } from '@/lib/time';
import { cn } from '@/lib/utils';

/** The day/month tile pinned to a cover's corner (hero and event cards). */
export function DateBlock({ date, size = 'default' }: { date: Date; size?: 'default' | 'lg' }) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        'absolute top-3 left-3 flex flex-col items-center rounded-lg bg-background text-foreground tabular shadow-md',
        size === 'lg' ? 'px-3.5 py-2.5' : 'px-3 py-2',
      )}
    >
      <span
        className={cn(
          'font-heading leading-none font-extrabold',
          size === 'lg' ? 'text-[26px]' : 'text-[20px]',
        )}
      >
        {formatInTimeZone(date, DHAKA_TZ, 'dd')}
      </span>
      <span className="text-[10px] font-semibold tracking-[0.12em] uppercase">
        {formatInTimeZone(date, DHAKA_TZ, 'MMM')}
      </span>
    </span>
  );
}
