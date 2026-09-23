import { describe, expect, it } from 'vitest';
import { EMAIL_KINDS, renderEmail } from '@/server/email/templates/render';
import type { EmailView } from '@/server/email/templates/view';
import type { TicketRecord } from '@/server/repositories/tickets.repository';
import { event, ticketType } from './helpers/fake-db';

const T0 = new Date('2026-09-17T05:20:00Z');

/** React separates adjacent text nodes with `<!-- -->`; phrases are asserted on the joined text. */
const joined = (html: string) => html.replace(/<!-- -->/g, '');

function view(over: Partial<EmailView> = {}): EmailView {
  const ev = event({ title: 'Echo & Aura Live — Dhaka', venue: 'ICCB Hall 4, Dhaka' });
  const tickets: TicketRecord[] = [
    {
      id: 't1',
      orderId: 'o1',
      ticketTypeId: 'tt-1',
      eventId: ev.id,
      code: 'TKT-4H8ZP2XQ',
      position: 1,
      attendeeName: 'Nusrat Jahan',
      status: 'issued',
      createdAt: T0,
      updatedAt: T0,
    },
    {
      id: 't2',
      orderId: 'o1',
      ticketTypeId: 'tt-1',
      eventId: ev.id,
      code: 'TKT-9WQ2LM5D',
      position: 2,
      attendeeName: 'তানভীর আলম',
      status: 'issued',
      createdAt: T0,
      updatedAt: T0,
    },
  ];
  return {
    order: {
      id: 'o1',
      reference: 'EA-7K3M9Q',
      eventId: ev.id,
      ticketTypeId: 'tt-1',
      quantity: 2,
      unitPricePaisa: 120_000,
      subtotalPaisa: 240_000,
      discountPaisa: 0,
      totalPaisa: 240_000,
      status: 'issued',
      buyerName: 'Nusrat Jahan',
      buyerEmail: 'nusrat@example.com',
      buyerPhone: '+8801712345678',
      attendeeNames: ['Nusrat Jahan', 'তানভীর আলম'],
      bkashTrxId: '9AB12CD34E',
      bkashSenderMsisdn: '+8801712345678',
      promoCodeId: null,
      rejectionReason: 'no_matching_credit',
      rejectionNote: 'No credit of ৳2,400.00 appears for 9AB12CD34E.',
      holdExpiresAt: new Date('2026-09-18T01:08:00Z'),
      createdAt: T0,
      updatedAt: T0,
    },
    event: ev,
    ticketType: ticketType({ name: 'General' }),
    tickets,
    promoCode: null,
    siteUrl: 'https://echoandaura.com',
    bkashNumber: '01712 345678',
    contactEmail: 'hello@echoandaura.com',
    contactPhone: '01712 345678',
    bkashAccountName: null,
    bkashAccountType: 'personal',
    verificationPromise: 'usually within 4 hours',
    organizerName: 'Raj',
    organizerAddress: null,
    availableNow: 124,
    at: T0,
    ...over,
  };
}

describe('email templates', () => {
  it('every kind renders html and a plain-text alternative', async () => {
    for (const kind of EMAIL_KINDS) {
      const r = await renderEmail(kind, view());
      expect(r.subject.length).toBeGreaterThan(10);
      expect(r.html).toContain('<html');
      expect(r.html).toContain('EA-7K3M9Q');
      expect(r.text).not.toContain('<');
      expect(r.text).toContain('EA-7K3M9Q');
    }
  });

  it('C1 carries the amount, the bKash number, the reference and the deadline', async () => {
    const r = await renderEmail(
      'payment-instructions',
      view({ order: { ...view().order, status: 'pending_payment' } }),
    );
    expect(r.subject).toBe('Finish your payment for Echo & Aura Live — Dhaka — EA-7K3M9Q');
    for (const s of [
      '৳2,400.00',
      '01712 345678',
      'EA-7K3M9Q',
      '18 Sep 2026, 07:08 (Dhaka)',
      'https://echoandaura.com/orders/o1',
    ]) {
      expect(joined(r.html)).toContain(s);
      expect(r.text).toContain(s);
    }
    // Personal account: "Send Money", the organizer's name and promise from the settings.
    expect(joined(r.html)).toContain('Send Money');
    expect(joined(r.html)).toContain('a personal account');
    expect(joined(r.html)).toContain('usually within 4 hours');
    expect(joined(r.html)).toContain('message Raj on 01712 345678');
    expect(joined(r.html)).toContain('Raj 01712 345678');
  });

  // B14: the bKash wording and the sender follow the settings, not the code.
  it('C1 says "Payment" for a merchant account and names the account and organizer', async () => {
    const r = await renderEmail(
      'payment-instructions',
      view({
        order: { ...view().order, status: 'pending_payment' },
        bkashAccountType: 'merchant',
        bkashAccountName: 'Echo Events Ltd',
        organizerName: 'Rajibul',
        organizerAddress: 'House 42, Banani, Dhaka',
        verificationPromise: 'within the hour',
      }),
    );
    const html = joined(r.html);
    expect(html).toContain('choose <strong>Payment</strong>');
    expect(html).not.toContain('Send Money');
    expect(html).toContain('(Echo Events Ltd)');
    expect(html).toContain('within the hour');
    expect(html).toContain('message Rajibul on 01712 345678');
    expect(html).toContain('House 42, Banani, Dhaka');
    expect(html).not.toContain('Raj ');
  });

  it('C2 lists every ticket with its code, name (Bengali intact), position and link', async () => {
    const r = await renderEmail('tickets-issued', view());
    expect(r.subject).toBe('Your 2 tickets for Echo & Aura Live — Dhaka');
    for (const s of [
      'TKT-4H8ZP2XQ',
      'TKT-9WQ2LM5D',
      'তানভীর আলম',
      'Ticket 2 of 2',
      'https://echoandaura.com/tickets/TKT-9WQ2LM5D',
      'tickets-EA-7K3M9Q.pdf',
      '26 Sep 2026',
    ]) {
      expect(joined(r.html)).toContain(s);
    }
    expect(r.text).toContain('TKT-4H8ZP2XQ');
  });

  // A re-send after an admin cancel: the dead ticket is gone, the subject
  // counts what is left, and the survivor keeps its place in the order.
  it('C2 re-sent after a cancel omits the cancelled ticket and counts live ones', async () => {
    const v = view();
    v.tickets[0]!.status = 'cancelled';
    const r = await renderEmail('tickets-issued', v);
    expect(r.subject).toBe('Your ticket for Echo & Aura Live — Dhaka');
    expect(joined(r.html)).not.toContain('TKT-4H8ZP2XQ');
    expect(joined(r.html)).toContain('TKT-9WQ2LM5D');
    expect(joined(r.html)).toContain('Ticket 2 of 2');
    expect(r.text).not.toContain('TKT-4H8ZP2XQ');
  });

  it('C3 quotes the reason label and the note word for word', async () => {
    const r = await renderEmail(
      'rejected',
      view({ order: { ...view().order, status: 'rejected' } }),
    );
    expect(r.subject).toContain('EA-7K3M9Q');
    expect(joined(r.html)).toContain('No matching credit in the bKash statement');
    expect(joined(r.html)).toContain('No credit of ৳2,400.00 appears for 9AB12CD34E.');
    expect(joined(r.html)).toContain('124 General tickets are still available');
    expect(r.text).toContain('No credit of ৳2,400.00 appears for 9AB12CD34E.');
  });

  it('C4 names the hold deadline, the unpaid amount and the stock left', async () => {
    const r = await renderEmail('expired', view({ order: { ...view().order, status: 'expired' } }));
    expect(r.subject).toBe('Your ticket hold has expired — EA-7K3M9Q');
    for (const s of [
      '18 Sep 2026, 07:08 (Dhaka)',
      '৳2,400.00 unpaid',
      '124 General tickets',
      'Do not send it again',
    ]) {
      expect(joined(r.html)).toContain(s);
    }
  });
});
