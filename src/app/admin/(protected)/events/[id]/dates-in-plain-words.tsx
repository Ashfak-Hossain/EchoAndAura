import type { EventRecord } from '@/server/repositories/events.repository';
import { publicVenueLine } from '@/server/lib/venue';
import { formatDhakaShort } from '@/lib/time';

/**
 * B5 side panel: the three dates that matter, as a sentence, so Raj can sanity
 * check what the form says without decoding four datetime fields.
 */
function Strong({ children }: { children: React.ReactNode }) {
  return <strong className="font-semibold text-foreground">{children}</strong>;
}

export function DatesInPlainWords({ event }: { event: EventRecord }) {
  return (
    <aside className="flex flex-col gap-3 rounded-xl border border-border bg-card p-[18px]">
      <h3 className="text-[15px] font-semibold">Dates in plain words</h3>
      <p className="text-sm leading-relaxed text-[#4a4640]">
        {event.registrationOpensAt ? (
          <>
            Tickets go on sale <Strong>{formatDhakaShort(event.registrationOpensAt)}</Strong>
            {', '}
          </>
        ) : (
          <>Registration has no opening date yet, </>
        )}
        {event.registrationClosesAt ? (
          <>
            sales stop <Strong>{formatDhakaShort(event.registrationClosesAt)}</Strong>
            {', '}
          </>
        ) : (
          <>no closing date yet, </>
        )}
        doors open <Strong>{formatDhakaShort(event.startsAt)}</Strong>. All times Dhaka.
      </p>
      {event.venueHidden ? (
        <p className="text-sm leading-relaxed text-[#4a4640]" data-testid="venue-private-summary">
          Venue: <Strong>private</Strong> — the public sees{' '}
          <Strong>“{publicVenueLine(event)}”</Strong>. Ticket holders get {event.venue}.
        </p>
      ) : null}
      <p className="border-t border-border pt-3 font-mono text-xs leading-relaxed text-muted-foreground">
        Stored in UTC · rendered Asia/Dhaka
      </p>
    </aside>
  );
}
