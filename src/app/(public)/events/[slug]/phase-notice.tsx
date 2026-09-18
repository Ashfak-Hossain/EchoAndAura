import type { EventPhase } from '@/server/lib/event-phase';
import { formatDhakaLong } from '@/lib/time';
import { cn } from '@/lib/utils';

interface Props {
  phase: EventPhase;
  registrationOpensAt: Date | null;
  registrationClosesAt: Date | null;
  now: Date;
}

/**
 * A2 top notice — the block above the title that explains the state. Only
 * rendered for not_open / closing_soon / sold_out / closed; open and past
 * need no explanation up top.
 */
export function PhaseNotice({ phase, registrationOpensAt, registrationClosesAt, now }: Props) {
  const box = (tone: string, bar: string, title: React.ReactNode, body: string) => (
    <div className={cn('flex gap-3 rounded-xl border px-4 py-3.5', tone)} role="status">
      <div className={cn('w-1.25 shrink-0 self-stretch rounded-[3px]', bar)} />
      <div>
        <div className="text-[15px] font-semibold">{title}</div>
        <div className="mt-0.5 text-sm leading-relaxed opacity-90">{body}</div>
      </div>
    </div>
  );

  switch (phase) {
    case 'not_open':
      return box(
        'border-[#c3d6ec] bg-info-tint text-[#123456]',
        'bg-info',
        registrationOpensAt
          ? `Registration opens ${formatDhakaLong(registrationOpensAt)} (Dhaka)`
          : 'Registration opens soon',
        'That is 20 days before the show — the same for every event we run.',
      );
    case 'closing_soon': {
      const ms = registrationClosesAt ? registrationClosesAt.getTime() - now.getTime() : 0;
      const h = Math.floor(ms / 3_600_000);
      const m = Math.floor((ms % 3_600_000) / 60_000);
      return box(
        'border-[#e8c48a] bg-warning-tint text-[#7a4600]',
        'bg-warning',
        <>
          Registration closes in{' '}
          <span className="font-mono font-medium tabular">
            {h}h {m}m
          </span>
        </>,
        `${registrationClosesAt ? formatDhakaLong(registrationClosesAt) : ''} (Dhaka). Payments must be checked before then, so leave a few hours.`,
      );
    }
    case 'sold_out':
      return box(
        'border-[#ddd8ce] bg-secondary text-foreground',
        'bg-[#a8a29a]',
        'Sold out',
        'Every ticket type has gone. There is no waitlist — if a hold expires, tickets quietly come back on sale here.',
      );
    case 'closed':
      return box(
        'border-[#ddd8ce] bg-secondary text-foreground',
        'bg-[#a8a29a]',
        registrationClosesAt
          ? `Registration closed ${formatDhakaLong(registrationClosesAt)} (Dhaka)`
          : 'Registration closed',
        'Registration always closes 5 days before the show so the door list can be printed. Nothing can be bought or changed now. Coming on the day? Have your ticket code ready at the door — the printed list is the backup.',
      );
    default:
      return null;
  }
}
