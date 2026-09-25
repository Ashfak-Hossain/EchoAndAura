import { describe, expect, it } from 'vitest';
import { phaseChipLabel } from '@/lib/phase-chip-label';

/** Canvas 6, N5: one chip vocabulary sitewide. */
const opens = new Date('2026-10-24T18:30:00Z'); // 00:30 on Sun 25 Oct in Dhaka
const card = { registrationOpensAt: opens, earlyBirdOnSale: false, variant: 'card' as const };
const hero = { ...card, variant: 'hero' as const };

describe('phaseChipLabel', () => {
  it('open: "On sale", or "Early Bird on sale" while the Early Bird sells', () => {
    expect(phaseChipLabel('open', hero)).toEqual({ tone: 'success', label: 'On sale', dot: true });
    expect(phaseChipLabel('open', { ...card, earlyBirdOnSale: true })).toEqual({
      tone: 'success',
      label: 'Early Bird on sale',
      dot: true,
    });
  });

  it('closing soon wins over the Early Bird', () => {
    expect(phaseChipLabel('closing_soon', { ...hero, earlyBirdOnSale: true })).toEqual({
      tone: 'warning',
      label: 'Closing soon',
      dot: true,
    });
  });

  it('not on sale yet: the hero says so, a card carries the Dhaka date', () => {
    expect(phaseChipLabel('not_open', hero)).toEqual({
      tone: 'info',
      label: 'Not on sale yet',
      dot: false,
    });
    expect(phaseChipLabel('not_open', card)).toEqual({
      tone: 'info',
      label: 'On sale 25 Oct',
      dot: false,
    });
    expect(phaseChipLabel('not_open', { ...card, registrationOpensAt: null }).label).toBe(
      'Not on sale yet',
    );
  });

  it('sold out, closed and past are quiet', () => {
    expect(phaseChipLabel('sold_out', card)).toEqual({
      tone: 'neutral',
      label: 'Sold out',
      dot: false,
    });
    expect(phaseChipLabel('closed', card)).toEqual({
      tone: 'neutral',
      label: 'Registration closed',
      dot: false,
    });
    expect(phaseChipLabel('past', hero)).toEqual({
      tone: 'neutralStrong',
      label: 'Past',
      dot: false,
    });
  });
});
