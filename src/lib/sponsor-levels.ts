import type { SponsorLevel, SponsorTileTone } from '@/server/repositories/sponsors.repository';

/**
 * Sponsor level and tile words (Canvas 6 / B15). One sponsor is "a
 * Partner"; a group of them is headed "Partners". The admin list, the form
 * and the public "Supported by" section all use these.
 */
export const SPONSOR_LEVEL_LABELS: Record<SponsorLevel, string> = {
  presenting: 'Presenting partner',
  partner: 'Partner',
  supporter: 'Supporter',
};

/** The heading over a level's logos. There is only ever one presenting partner. */
export const SPONSOR_GROUP_LABELS: Record<SponsorLevel, string> = {
  presenting: 'Presenting partner',
  partner: 'Partners',
  supporter: 'Supporters',
};

export const SPONSOR_TILE_LABELS: Record<SponsorTileTone, string> = {
  light: 'Light',
  dark: 'Dark',
};
