/**
 * Renders the four transactional emails with sample data into
 * tmp/emails/preview-*.html so they can be opened in a browser or pasted
 * into an email-client tester. `pnpm email:render`.
 */
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { EMAIL_KINDS, renderEmail } from '@/server/email/templates/render';
import type { EmailView } from '@/server/email/templates/view';
import { resolveSettings } from '@/server/services/settings.service';

const T0 = new Date('2026-09-17T05:20:00Z');
const NOW = new Date();

const seed = resolveSettings(null);

const view: EmailView = {
  order: {
    id: '00000000-0000-4000-8000-000000000001',
    reference: 'EA-7K3M9Q',
    eventId: 'ev',
    ticketTypeId: 'tt',
    quantity: 3,
    unitPricePaisa: 120_000,
    subtotalPaisa: 360_000,
    discountPaisa: 0,
    totalPaisa: 360_000,
    status: 'issued',
    buyerName: 'Nusrat Jahan',
    buyerEmail: 'nusrat.jahan@example.com',
    buyerPhone: '+8801712345678',
    attendeeNames: ['Nusrat Jahan', 'তানভীর আলম', 'Farhana Rahman'],
    bkashTrxId: '9AB12CD34E',
    bkashSenderMsisdn: '+8801712345678',
    promoCodeId: null,
    rejectionReason: 'no_matching_credit',
    rejectionNote:
      'No credit of ৳3,600.00 from 01712345678 appears in the statement for 9AB12CD34E.',
    complimentaryReason: null,
    holdExpiresAt: new Date(NOW.getTime() + 24 * 3_600_000),
    createdAt: T0,
    updatedAt: T0,
  },
  event: {
    id: 'ev',
    slug: 'echo-aura-live-dhaka',
    title: 'Echo & Aura Live — Dhaka',
    description: null,
    venue: 'ICCB Hall 4, Dhaka',
    venueHidden: false,
    venueArea: null,
    startsAt: new Date('2026-10-01T13:00:00Z'),
    endsAt: null,
    registrationOpensAt: new Date('2026-09-11T13:00:00Z'),
    registrationClosesAt: new Date('2026-09-26T17:59:00Z'),
    status: 'published',
    imageKey: null,
    createdAt: T0,
    updatedAt: T0,
  },
  ticketType: {
    id: 'tt',
    eventId: 'ev',
    name: 'General',
    pricePaisa: 120_000,
    quantityTotal: 400,
    quantitySold: 270,
    quantityReserved: 6,
    salesStartsAt: null,
    salesEndsAt: null,
    createdAt: T0,
    updatedAt: T0,
  },
  tickets: ['TKT-4H8ZP2XQ', 'TKT-9WQ2LM5D', 'TKT-6BN4RT1K'].map((code, i) => ({
    id: `t${i}`,
    orderId: '00000000-0000-4000-8000-000000000001',
    ticketTypeId: 'tt',
    eventId: 'ev',
    code,
    position: i + 1,
    attendeeName: ['Nusrat Jahan', 'তানভীর আলম', 'Farhana Rahman'][i]!,
    status: 'issued',
    checkedInAt: null,
    checkedInBy: null,
    checkedInScanId: null,
    createdAt: T0,
    updatedAt: T0,
  })),
  siteUrl: process.env.SITE_URL ?? 'https://echoandaura.com',
  // The env seed, exactly as a fresh database resolves it — with demo values where env is blank.
  promoCode: null,
  bkashNumber: seed.bkashReceiveNumber ?? '01712 345678',
  contactEmail: seed.supportEmail ?? 'hello@echoandaura.com',
  contactPhone: seed.supportPhone ?? '01712 345678',
  bkashAccountName: 'Rajibul Karim',
  bkashAccountType: seed.bkashAccountType,
  verificationPromise: seed.verificationPromise,
  organizerName: seed.organizerName,
  organizerAddress: 'House 42, Road 11, Banani, Dhaka 1213',
  availableNow: 124,
  at: T0,
};

async function main(): Promise<void> {
  const dir = path.join(process.cwd(), 'tmp', 'emails');
  await mkdir(dir, { recursive: true });
  for (const kind of EMAIL_KINDS) {
    const r = await renderEmail(kind, view);
    await writeFile(path.join(dir, `preview-${kind}.html`), r.html);
    await writeFile(path.join(dir, `preview-${kind}.txt`), `Subject: ${r.subject}\n\n${r.text}`);
    console.log(`${kind}: ${r.subject}`);
  }
  console.log(`\nwritten to ${dir}`);
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
