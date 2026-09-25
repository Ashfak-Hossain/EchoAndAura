import type { EventPhase } from '@/server/lib/event-phase';
import { Chip } from '@/components/status-chip';
import { phaseChipLabel } from '@/lib/phase-chip-label';

/**
 * An event's sale-phase chip (Canvas 6, N5), from the same `eventPhase`
 * value everywhere: the home hero, event cards and the event page. The
 * words and tone come from `phaseChipLabel`; this only draws them.
 *
 * The hero's chip always carries an 8px dot in its ink colour (N5 "hero
 * adds 8px dot in fg colour"): on the charcoal band it marks the chip as
 * the event's state, not a button. Elsewhere only live phases get a dot.
 */
export function PhaseChip({
  phase,
  registrationOpensAt,
  earlyBirdOnSale,
  variant,
  size = 'default',
  className,
}: {
  phase: EventPhase;
  registrationOpensAt: Date | null;
  /** From `offerSummary`: turns "On sale" into "Early Bird on sale". */
  earlyBirdOnSale: boolean;
  /** `card` dates "not on sale yet" ("On sale 25 Oct"); the hero says it in its sentence. */
  variant: 'hero' | 'card';
  size?: 'default' | 'sm';
  className?: string;
}) {
  const chip = phaseChipLabel(phase, { registrationOpensAt, earlyBirdOnSale, variant });
  const hero = variant === 'hero';
  return (
    <Chip tone={chip.tone} dot={!hero && chip.dot} size={size} className={className}>
      {hero ? <span aria-hidden="true" className="size-2 rounded-full bg-current" /> : null}
      {chip.label}
    </Chip>
  );
}
