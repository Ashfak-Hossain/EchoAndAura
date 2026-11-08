import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { OrderRecord } from '@/server/repositories/orders.repository';
import type { OrderView } from '@/server/services/orders.service';
import { event, ticketType } from './helpers/fake-db';
import { useTestLocale } from './setup/intl';

/**
 * L3: the order flow in Bangla. Every frame of the order page renders in
 * both languages with no missing key and no ICU error; what people copy
 * into bKash (the number, the reference, the TrxID, ticket codes) stays in
 * Latin digits on /bn, and what they only read follows the page.
 */

vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: vi.fn() }),
  notFound: () => {
    throw new Error('NOT_FOUND');
  },
}));
const getOrder = vi.fn<(id: string) => Promise<OrderView>>();
vi.mock('@/server/container', () => ({
  ordersService: { getOrder: (id: string) => getOrder(id), submitPayment: vi.fn() },
}));
const settings = {
  bkashReceiveNumber: '01712 345678',
  supportEmail: 'help@example.com',
  bkashAccountType: 'personal',
  bkashAccountName: null as string | null,
  verificationPromise: 'usually within 2 hours',
  organizerName: 'Echo Events',
};
vi.mock('@/lib/settings', () => ({ getSiteSettings: async () => settings }));

const { default: OrderPage } = await import('@/app/(public)/orders/[id]/page');
const { RegistrationForm } =
  await import('@/app/(public)/events/[slug]/register/registration-form');
const { CopyField } = await import('@/app/(public)/orders/[id]/copy-field');

const ID = '0b9a3c1e-5d6f-4a7b-8c9d-0e1f2a3b4c5d';
const at = new Date('2026-10-10T13:30:00Z'); // 7:30 PM in Dhaka

function order(over: Partial<OrderRecord> = {}): OrderRecord {
  return {
    id: ID,
    reference: 'EA-7K3M9Q',
    eventId: 'ev-1',
    ticketTypeId: 'tt-1',
    quantity: 2,
    unitPricePaisa: 120_000,
    subtotalPaisa: 240_000,
    discountPaisa: 0,
    totalPaisa: 240_000,
    status: 'pending_payment',
    buyerName: 'Nusrat Jahan',
    buyerEmail: 'nusrat@example.com',
    buyerPhone: '+8801712345678',
    attendeeNames: ['Nusrat Jahan', 'Nusrat Jahan'],
    bkashTrxId: null,
    bkashSenderMsisdn: null,
    promoCodeId: null,
    rejectionReason: null,
    rejectionNote: null,
    complimentaryReason: null,
    locale: 'bn',
    // Far ahead, so the awaiting frame never reads as lapsed.
    holdExpiresAt: new Date(Date.now() + 15 * 60_000),
    createdAt: at,
    updatedAt: at,
    ...over,
  };
}

function view(over: Partial<OrderRecord> = {}, extra: Partial<OrderView> = {}): OrderView {
  return {
    order: order(over),
    event: event({ startsAt: at }),
    ticketType: ticketType({ name: 'General' }),
    events: [],
    tickets: [],
    promoCode: null,
    ...extra,
  };
}

const FRAMES: Record<string, OrderView> = {
  awaiting: view(),
  checking: view(
    {
      status: 'pending_verification',
      bkashTrxId: '9AB12CD34E',
      bkashSenderMsisdn: '+8801812345678',
    },
    { events: [{ action: 'payment.submitted', createdAt: at } as never] },
  ),
  expired: view({ status: 'expired', holdExpiresAt: at }),
  issued: view(
    { status: 'issued', bkashTrxId: '9AB12CD34E' },
    {
      events: [{ action: 'payment.approved', createdAt: at } as never],
      tickets: [
        { id: 't1', code: 'TKT-P63DEW26', attendeeName: 'Nusrat Jahan', status: 'issued' },
        { id: 't2', code: 'TKT-Q74EFX37', attendeeName: 'Tanvir Alam', status: 'cancelled' },
      ] as never,
    },
  ),
  rejected: view(
    { status: 'rejected', rejectionReason: 'amount_mismatch', rejectionNote: 'Sent ৳1,000 only' },
    { events: [{ action: 'payment.rejected', createdAt: at } as never] },
  ),
  cancelled: view({ status: 'cancelled' }),
};

const render = async () =>
  renderToStaticMarkup(await OrderPage({ params: Promise.resolve({ id: ID }) }));
const text = (html: string) =>
  html
    .replace(/<[^>]+>/g, ' ')
    .replace(/&#x27;|&#39;/g, "'")
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ');

let errors: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  // use-intl reports a missing key or a broken message here, then prints the key.
  errors = vi.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => {
  expect(errors).not.toHaveBeenCalled();
  errors.mockRestore();
  useTestLocale('en');
});

const CASES = Object.keys(FRAMES).flatMap((frame) =>
  (['en', 'bn'] as const).map((locale) => ({ frame, locale })),
);

describe('order page: every frame in both languages', () => {
  it.each(CASES)('$frame in $locale renders with no missing text', async ({ frame, locale }) => {
    getOrder.mockResolvedValue(FRAMES[frame]!);
    useTestLocale(locale);
    const out = text(await render());
    expect(out).not.toMatch(/\b(order|common|status|holdClock|copyField)\.[a-z]/i);
    expect(out).toContain('EA-7K3M9Q');
  });
});

describe('order page in Bangla', () => {
  beforeEach(() => useTestLocale('bn'));

  it('awaiting: Bangla text and amounts; the bKash number and reference stay Latin', async () => {
    getOrder.mockResolvedValue(FRAMES.awaiting!);
    const out = text(await render());
    expect(out).toContain('বিকাশে কীভাবে পেমেন্ট করবেন');
    expect(out).toContain('৳২,৪০০.০০');
    expect(out).toContain('সেন্ড মানি');
    expect(out).toContain('01712 345678');
    expect(out).toContain('পেমেন্টের অপেক্ষায়');
    expect(out).toContain('help@example.com');
    // The organizer's own promise is quoted as entered.
    expect(out).toContain('usually within 2 hours');
  });

  it('checking: the TrxID and the sending number stay Latin', async () => {
    getOrder.mockResolvedValue(FRAMES.checking!);
    const out = text(await render());
    expect(out).toContain('আপনার পেমেন্ট যাচাই হচ্ছে');
    expect(out).toContain('9AB12CD34E');
    expect(out).toContain('+880 1812345678');
    expect(out).toContain('সন্ধ্যা ৭:৩০');
  });

  it('issued: ticket codes stay Latin; counts and statuses are Bangla', async () => {
    getOrder.mockResolvedValue(FRAMES.issued!);
    const out = text(await render());
    expect(out).toContain('TKT-P63DEW26');
    expect(out).toContain('টিকিট ১ · General');
    expect(out).toContain('২টি টিকিট');
    expect(out).toContain('বাতিল');
  });

  it("rejected: the reason from the fixed list is Bangla; the organizer's note is shown as typed", async () => {
    getOrder.mockResolvedValue(FRAMES.rejected!);
    const out = text(await render());
    expect(out).toContain('পাঠানো টাকা অর্ডারের মোটের সঙ্গে মেলে না');
    expect(out).toContain('Sent ৳1,000 only');
  });
});

describe('order page in English is unchanged', () => {
  it('awaiting keeps the design wording', async () => {
    getOrder.mockResolvedValue(FRAMES.awaiting!);
    const out = text(await render());
    expect(out).toContain('Open the bKash app and choose Send Money .');
    expect(out).toContain('Send exactly ৳2,400.00 to this number — it is a personal account.');
    expect(out).toContain('Stuck? Message the organizer at help@example.com .');
    expect(out).toContain('Awaiting payment');
  });

  it('issued keeps its sentence', async () => {
    getOrder.mockResolvedValue(FRAMES.issued!);
    const out = text(await render());
    expect(out).toContain('2 tickets are in your inbox at nusrat@example.com .');
    expect(out).toContain('Ticket 1 · General');
  });
});

describe('registration form in Bangla', () => {
  beforeEach(() => useTestLocale('bn'));

  it('labels, counts and prices follow the page; +880 stays as people type it', () => {
    const out = text(
      renderToStaticMarkup(
        createElement(RegistrationForm, {
          action: async () => ({}),
          checkPromo: async () => ({ ok: false, reason: 'unknown' }) as never,
          options: [
            {
              id: 'tt-gen',
              name: 'General',
              pricePaisa: 120_000,
              available: 7,
              maxPerOrder: 7,
              reason: null,
            },
          ],
          registrationClosesAt: null,
          siteKey: '',
        }),
      ),
    );
    expect(out).toContain('আপনার তথ্য');
    expect(out).toContain('মাত্র ৭টি বাকি');
    expect(out).toContain('৳১,২০০.০০');
    expect(out).toContain('+880');
    expect(out).toContain('শর্তাবলিতে');
    expect(out).toContain('পেমেন্টে এগোন');
    // The bot check's own line (ADR-048) follows the page too.
    expect(out).toContain('জাভাস্ক্রিপ্ট চালু করুন');
    expect(out).not.toContain('turn on JavaScript');
  });
});

describe('bot check text', () => {
  it("the widget's English default is the catalogue's English, word for word", async () => {
    const { TURNSTILE_ENGLISH } = await import('@/components/turnstile-widget');
    const { default: en } = await import('@/messages/en');
    expect(TURNSTILE_ENGLISH).toEqual(en.botCheck);
  });
});

describe('CopyField', () => {
  it('copies the Latin value; only the button is Bangla', () => {
    useTestLocale('bn');
    const html = renderToStaticMarkup(
      createElement(CopyField, { label: 'অর্ডার রেফারেন্স', value: 'EA-7K3M9Q' }),
    );
    expect(html).toContain('EA-7K3M9Q');
    expect(html).toContain('>কপি<');
    expect(html).toContain('aria-label="অর্ডার রেফারেন্স কপি করুন"');
  });
});
