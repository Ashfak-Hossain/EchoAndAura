import { sponsorsService } from '@/server/container';
import type { PresentingSponsorOption } from './event-form';

/**
 * Every sponsor the event form's "Presenting sponsor" select offers, in the
 * B15 list's order. Hidden ones are included (marked in the select): an
 * event can keep its presenter while the sponsor is off the site. Only
 * what the select needs is sent to the browser.
 */
export async function presentingSponsorOptions(): Promise<PresentingSponsorOption[]> {
  const groups = await sponsorsService.listForAdmin();
  return groups.flatMap((g) => g.sponsors.map(({ id, name, active }) => ({ id, name, active })));
}
