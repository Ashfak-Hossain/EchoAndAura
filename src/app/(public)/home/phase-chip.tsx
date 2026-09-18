import { formatInTimeZone } from 'date-fns-tz';
import type { EventPhase } from '@/server/lib/event-phase';
import { Chip } from '@/components/status-chip';
import type { ChipTone } from '@/lib/status-labels';
import { DHAKA_TZ } from '@/lib/time';

/**
 * A1 availability chip: the same `eventPhase` value as A2, worded for a
 * card. "Opens 11 Sep" carries the date so a dormant hero still tells the
 * buyer when to come back.
 */
export function PhaseChip({
  phase,
  registrationOpensAt,
  size = 'default',
}: {
  phase: EventPhase;
  registrationOpensAt: Date | null;
  size?: 'default' | 'sm';
}) {
  const [tone, label]: [ChipTone, string] = (() => {
    switch (phase) {
      case 'open':
        return ['success', 'Open'];
      case 'closing_soon':
        return ['warning', 'Closing soon'];
      case 'not_open':
        return [
          'info',
          registrationOpensAt
            ? `Opens ${formatInTimeZone(registrationOpensAt, DHAKA_TZ, 'd MMM')}`
            : 'Opens soon',
        ];
      case 'sold_out':
        return ['neutralStrong', 'Sold out'];
      case 'closed':
        return ['neutral', 'Registration closed'];
      case 'past':
        return ['neutral', 'Past'];
    }
  })();
  return (
    <Chip tone={tone} size={size} dot={tone === 'success' || tone === 'warning'}>
      {label}
    </Chip>
  );
}
