import { useLocale, useTranslations } from 'next-intl';
import { groupDigits, plainDigits } from '@/server/lib/digits';
import type { EventPhase } from '@/server/lib/event-phase';
import { REGISTRATION_OPENS_DAYS_BEFORE } from '@/server/lib/registration-window';
import { REGISTRATION_CLOSES_DAYS_BEFORE } from '@/content/site';
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
  const t = useTranslations('notice');
  const hero = useTranslations('hero');
  const locale = useLocale();
  const inDhaka = (date: Date) => hero('inDhaka', { when: formatDhakaLong(date, locale) });
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
        registrationOpensAt ? t('opens', { when: inDhaka(registrationOpensAt) }) : t('opensSoon'),
        t('opensBody', { days: groupDigits(REGISTRATION_OPENS_DAYS_BEFORE, locale) }),
      );
    case 'closing_soon': {
      const ms = registrationClosesAt ? registrationClosesAt.getTime() - now.getTime() : 0;
      const h = Math.floor(ms / 3_600_000);
      const m = Math.floor((ms % 3_600_000) / 60_000);
      return box(
        'border-[#e8c48a] bg-warning-tint text-[#7a4600]',
        'bg-warning',
        <>
          {t('closesIn')}{' '}
          <span className="font-mono font-medium tabular">
            {t('hoursMinutes', { h: plainDigits(h, locale), m: plainDigits(m, locale) })}
          </span>
        </>,
        t('closesBody', {
          when: hero('inDhaka', {
            when: registrationClosesAt ? formatDhakaLong(registrationClosesAt, locale) : '',
          }),
        }),
      );
    }
    case 'sold_out':
      return box(
        'border-[#ddd8ce] bg-secondary text-foreground',
        'bg-[#a8a29a]',
        t('soldOut'),
        t('soldOutBody'),
      );
    case 'closed':
      return box(
        'border-[#ddd8ce] bg-secondary text-foreground',
        'bg-[#a8a29a]',
        registrationClosesAt ? t('closedAt', { when: inDhaka(registrationClosesAt) }) : t('closed'),
        t('closedBody', { days: groupDigits(REGISTRATION_CLOSES_DAYS_BEFORE, locale) }),
      );
    default:
      return null;
  }
}
