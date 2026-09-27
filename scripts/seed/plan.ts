import { addDays, addHours, addMinutes } from 'date-fns';
import { formatInTimeZone, fromZonedTime } from 'date-fns-tz';
import { takaToPaisa } from '@/server/lib/money';
import { DHAKA_TZ } from '@/lib/time';
import type { SponsorLevel, SponsorTileTone } from '@/server/repositories/sponsors.repository';
import { PEOPLE, type Person, phoneFor } from './people';

/**
 * The dev seed's data, as a pure function of "now": five events in every
 * public phase, their ticket types, three promo codes, eight sponsors and
 * ~150 orders, each with a storyline and the moments it happens.
 * Deterministic (seeded PRNG), so every run tells the same story; relative
 * to `now`, so it never goes stale. No I/O — the runner executes it through
 * the real services, and tests/unit/seed-plan.test.ts proves every order is
 * buyable when it is.
 */

export type Story =
  | 'issued'
  | 'pending_verification'
  | 'pending_payment'
  | 'rejected'
  | 'expired'
  | 'comp'
  | 'cancel_one';

export interface SeedTicketType {
  key: string;
  name: string;
  pricePaisa: number;
  quantityTotal: number;
  salesStartsAt?: Date;
  salesEndsAt?: Date;
}

export interface SeedEvent {
  key: string;
  slug: string;
  title: string;
  description: string;
  venue: string;
  venueHidden: boolean;
  venueArea?: string;
  startsAt: Date;
  endsAt: Date;
  registrationOpensAt: Date;
  registrationClosesAt: Date;
  /** Clock for creating and publishing the event. */
  createdAt: Date;
  /** Archived after it happened (the past event). */
  archiveAt?: Date;
  /** Cover gradient hue, 0–360. */
  hue: number;
  /** Sponsor key shown as "Presented by"; the sponsor must be active to show. */
  presenter?: string;
  ticketTypes: SeedTicketType[];
}

/** The shapes the design's placeholder logos use (logos.ts draws them). */
export type SponsorMark = 'bars' | 'circle' | 'square' | 'tri' | 'ring';

export interface SeedSponsor {
  key: string;
  name: string;
  /** Shorter wordmark text when the full name would be too small to read. */
  wordmark?: string;
  level: SponsorLevel;
  tileTone: SponsorTileTone;
  active: boolean;
  /** Null: the tile is a plain logo, not a link. */
  websiteUrl: string | null;
  /** Logo width ÷ height: the generated SVG's viewBox is (100 × aspect) × 100. */
  aspect: number;
  mark: SponsorMark;
  /** The mark's colour. */
  colour: string;
  /** The wordmark's colour; charcoal unless the logo is made for a dark tile. */
  ink?: string;
}

export interface SeedPromo {
  code: string;
  type: 'percentage' | 'fixed';
  /** Whole percent, or paisa. */
  value: number;
  active: boolean;
  /** Empty = any ticket type. */
  restrictTo: { eventKey: string; typeKey: string }[];
}

export interface SeedOrder {
  eventKey: string;
  typeKey: string;
  quantity: number;
  buyer: Person;
  phone: string;
  story: Story;
  promoCode?: string;
  createdAt: Date;
  submittedAt?: Date;
  /** Approved, rejected — or, for a comp, when it was issued (= createdAt). */
  decidedAt?: Date;
  /** cancel_one: when the first ticket is cancelled. */
  cancelledAt?: Date;
  trxId?: string;
  reason?: string;
}

export interface SeedPlan {
  now: Date;
  /** Clock for creating the promo codes (before any order). */
  promosAt: Date;
  /** Clock for creating the sponsors (before any event names a presenter). */
  sponsorsAt: Date;
  events: SeedEvent[];
  promos: SeedPromo[];
  /** In display order within each level: the service appends each one. */
  sponsors: SeedSponsor[];
  orders: SeedOrder[];
}

/** mulberry32: small, fast, deterministic. */
function prng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4_294_967_296;
  };
}

export function buildSeedPlan(now: Date): SeedPlan {
  const rand = prng(20_260_924);
  const int = (lo: number, hi: number) => lo + Math.floor(rand() * (hi - lo + 1));
  const pick = <T>(xs: readonly T[]) => xs[Math.floor(rand() * xs.length)]!;

  // Dhaka wall-clock anchor: day offsets from today's Dhaka date.
  const todayDhaka = formatInTimeZone(now, DHAKA_TZ, 'yyyy-MM-dd');
  const midnight = fromZonedTime(`${todayDhaka}T00:00:00`, DHAKA_TZ);
  const at = (dayOffset: number, hour = 0, minute = 0) =>
    addMinutes(addHours(addDays(midnight, dayOffset), hour), minute);

  // People register mostly in the evening (B12 "when people register").
  const HOURS = [9, 11, 13, 14, 16, 18, 19, 20, 20, 21, 21, 21, 22, 22, 23, 23, 0, 1];
  /** A plausible moment in [from, to]: a random day, an evening-heavy hour. */
  const momentBetween = (from: Date, to: Date): Date => {
    for (let tries = 0; tries < 50; tries++) {
      const t = new Date(from.getTime() + rand() * (to.getTime() - from.getTime()));
      const day = formatInTimeZone(t, DHAKA_TZ, 'yyyy-MM-dd');
      const hour = pick(HOURS);
      const candidate = addMinutes(
        fromZonedTime(`${day}T${String(hour).padStart(2, '0')}:00:00`, DHAKA_TZ),
        int(0, 59),
      );
      if (candidate >= from && candidate <= to) return candidate;
    }
    return new Date(from.getTime() + rand() * (to.getTime() - from.getTime()));
  };

  let personIndex = 0;
  const nextBuyer = () => {
    const i = personIndex++;
    return { buyer: PEOPLE[i % PEOPLE.length]!, phone: phoneFor(i) };
  };
  let trx = 0;
  const nextTrx = () => {
    const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    let s = 'S' + (++trx).toString(36).toUpperCase().padStart(3, '0');
    while (s.length < 10) s += alphabet[int(0, alphabet.length - 1)];
    return s;
  };

  const orders: SeedOrder[] = [];
  const cap = (latest: Date) => (latest > now ? now : latest);

  /** One order with its storyline timed inside [from, to]. */
  const order = (
    eventKey: string,
    typeKey: string,
    quantity: number,
    story: Story,
    from: Date,
    to: Date,
    extra: Partial<SeedOrder> = {},
  ) => {
    const createdAt = momentBetween(from, to);
    const o: SeedOrder = {
      eventKey,
      typeKey,
      quantity,
      story,
      createdAt,
      ...nextBuyer(),
      ...extra,
    };
    if (
      story === 'issued' ||
      story === 'rejected' ||
      story === 'cancel_one' ||
      story === 'pending_verification'
    ) {
      o.submittedAt = cap(addMinutes(createdAt, int(12, 360)));
      o.trxId = nextTrx();
    }
    if (story === 'issued' || story === 'rejected' || story === 'cancel_one') {
      o.decidedAt = cap(addMinutes(o.submittedAt!, int(25, 600)));
    }
    if (story === 'rejected') o.reason = pick(['no_matching_credit', 'amount_mismatch']);
    if (story === 'cancel_one') o.cancelledAt = cap(addDays(o.decidedAt!, 1));
    if (story === 'comp') o.decidedAt = createdAt;
    orders.push(o);
    return o;
  };

  /** Quantities of 1–4 that add up to exactly `total` (a sell-out). */
  const splitExactly = (total: number): number[] => {
    const out: number[] = [];
    let left = total;
    while (left > 0) {
      const q = Math.min(left, pick([1, 2, 2, 2, 3, 4]));
      out.push(q);
      left -= q;
    }
    return out;
  };

  // --- Events -------------------------------------------------------------
  // Registration follows the business rule: opens 20 days before, closes 5
  // days before (defaultRegistrationWindow); stored explicitly here.
  const schedule = (startDay: number) => ({
    startsAt: at(startDay, 19),
    endsAt: at(startDay, 23),
    registrationOpensAt: at(startDay - 20, 10),
    registrationClosesAt: at(startDay - 5, 23, 59),
  });

  const live: SeedEvent = {
    key: 'live',
    slug: 'echo-aura-live-dhaka',
    title: 'Echo & Aura Live — Dhaka',
    description:
      '<p>Four acts, one room, no support slots. The biggest night we have put on: a full live set from Echo &amp; Aura with the string section, plus three of our favourite Dhaka bands opening the evening.</p><h2>The night</h2><ul><li>Doors 7:00 pm, first act 7:45 pm</li><li>Standing floor; VIP gets the balcony and a drink</li><li>Food stalls in the lobby</li></ul><p>Tickets are named. Show your ticket QR at the door — your name and code work too.</p>',
    venue: 'ICCB Hall 4, Bashundhara, Dhaka',
    venueHidden: false,
    ...schedule(12),
    createdAt: at(-10, 11),
    hue: 28,
    presenter: 'kolorob',
    ticketTypes: [
      {
        key: 'early',
        name: 'Early Bird',
        pricePaisa: takaToPaisa(900),
        quantityTotal: 40,
        salesStartsAt: at(-8, 10),
        salesEndsAt: at(-3, 23, 59),
      },
      { key: 'general', name: 'General', pricePaisa: takaToPaisa(1200), quantityTotal: 300 },
      { key: 'vip', name: 'VIP', pricePaisa: takaToPaisa(3500), quantityTotal: 40 },
    ],
  };
  const monsoon: SeedEvent = {
    key: 'monsoon',
    slug: 'monsoon-sessions-acoustic-rooftop',
    title: 'Monsoon Sessions — Acoustic Rooftop',
    description:
      '<p>An unplugged evening on a rooftop above Banani: two sets, eighty people, whatever the weather does. There is a roof over the stage and blankets if it rains.</p><p>The exact address comes with your tickets — please keep it off social media so the night stays small.</p>',
    venue: 'Rooftop 12, Road 11, Banani, Dhaka 1213',
    venueHidden: true,
    venueArea: 'Banani, Dhaka',
    ...schedule(6),
    createdAt: at(-16, 12),
    hue: 205,
    ticketTypes: [
      { key: 'general', name: 'General', pricePaisa: takaToPaisa(1500), quantityTotal: 80 },
    ],
  };
  const poetry: SeedEvent = {
    key: 'poetry',
    slug: 'poetry-and-pints',
    title: 'Poetry & Pints',
    description:
      '<p>Open-mic poetry in Bangla and English, a short headline reading, and tea that is stronger than it looks. Sixty seats, and that is all of them.</p>',
    venue: 'Jatra Biroti, House 60, Road 7/A, Dhanmondi, Dhaka',
    venueHidden: false,
    ...schedule(14),
    createdAt: at(-9, 15),
    hue: 330,
    ticketTypes: [
      { key: 'general', name: 'General', pricePaisa: takaToPaisa(600), quantityTotal: 60 },
    ],
  };
  const winter: SeedEvent = {
    key: 'winter',
    slug: 'winter-ember-night',
    title: 'Winter Ember Night',
    description:
      '<p>The season closer: a long evening of slow songs and bright lights in the Shilpakala courtyard. Early Bird goes first — registration opens ten days from now.</p>',
    venue: 'Bangladesh Shilpakala Academy, Segunbagicha, Dhaka',
    venueHidden: false,
    ...schedule(30),
    createdAt: at(-2, 14),
    hue: 12,
    ticketTypes: [
      {
        key: 'early',
        name: 'Early Bird',
        pricePaisa: takaToPaisa(1000),
        quantityTotal: 80,
        salesEndsAt: at(16, 23, 59),
      },
      { key: 'general', name: 'General', pricePaisa: takaToPaisa(1400), quantityTotal: 200 },
    ],
  };
  const spring: SeedEvent = {
    key: 'spring',
    slug: 'spring-fever-26',
    title: 'Spring Fever ’26',
    description:
      '<p>Where it started: our first stadium night, three bands and an encore nobody had rehearsed. Thank you to everyone who came.</p>',
    venue: 'Army Stadium, Banani, Dhaka',
    venueHidden: false,
    ...schedule(-70),
    createdAt: at(-100, 11),
    archiveAt: at(-60, 10),
    hue: 145,
    ticketTypes: [
      { key: 'general', name: 'General', pricePaisa: takaToPaisa(1000), quantityTotal: 150 },
      { key: 'vip', name: 'VIP', pricePaisa: takaToPaisa(3000), quantityTotal: 20 },
    ],
  };
  const events = [live, monsoon, poetry, winter, spring];

  // --- Sponsors -----------------------------------------------------------
  // The Canvas 6 design's sample sponsors (home-page.dc.html), picked for
  // range: every level, logos from near-square to 7:1 (the tile formula's
  // extremes), a hidden partner, a dark tile, and one with no website (a
  // plain tile, not a link). Kolorob presents the live show.
  const site = (k: string) => `https://${k}.example`;
  const sponsors: SeedSponsor[] = [
    {
      key: 'kolorob',
      name: 'Kolorob Audio',
      level: 'presenting',
      tileTone: 'light',
      active: true,
      websiteUrl: site('kolorob'),
      aspect: 3,
      mark: 'bars',
      colour: '#0F5B8C',
    },
    {
      key: 'nodi',
      name: 'Nodi Coffee Roasters',
      wordmark: 'Nodi Coffee',
      level: 'partner',
      tileTone: 'light',
      active: true,
      websiteUrl: site('nodi'),
      aspect: 2.6,
      mark: 'circle',
      colour: '#6B3F1D',
    },
    {
      key: 'parabaas',
      name: 'Parabaas Printing House',
      level: 'partner',
      tileTone: 'light',
      active: true,
      websiteUrl: site('parabaas'),
      aspect: 7,
      mark: 'square',
      colour: '#B3261E',
    },
    {
      key: 'megh',
      name: 'Megh Stage Rentals',
      wordmark: 'Megh Stage',
      level: 'partner',
      tileTone: 'light',
      active: false,
      websiteUrl: site('megh'),
      aspect: 3.4,
      mark: 'tri',
      colour: '#1C1A17',
    },
    {
      key: 'bhor',
      name: 'Bhor FM',
      level: 'supporter',
      tileTone: 'dark',
      active: true,
      websiteUrl: site('bhor'),
      aspect: 2,
      mark: 'ring',
      colour: '#EDA43C',
      ink: '#FBFAF8',
    },
    {
      key: 'ghuri',
      name: 'Ghuri Studio',
      level: 'supporter',
      tileTone: 'light',
      active: true,
      websiteUrl: site('ghuri'),
      aspect: 2.4,
      mark: 'tri',
      colour: '#6B3FA0',
    },
    {
      key: 'pakhi',
      name: 'Pakhi Press',
      level: 'supporter',
      tileTone: 'light',
      active: true,
      websiteUrl: null,
      aspect: 1.2,
      mark: 'circle',
      colour: '#9A3412',
    },
    {
      key: 'rongdhonu',
      name: 'Rongdhonu Lights',
      level: 'supporter',
      tileTone: 'light',
      active: true,
      websiteUrl: site('rongdhonu'),
      aspect: 4.5,
      mark: 'ring',
      colour: '#BE185D',
    },
  ];

  // --- Orders -------------------------------------------------------------
  const settled = addHours(now, -20); // an issued order was placed at least this long ago

  // Echo & Aura Live: Early Bird sold out inside its window.
  for (const q of splitExactly(40)) {
    order(
      'live',
      'early',
      q,
      'issued',
      live.ticketTypes[0]!.salesStartsAt!,
      addHours(live.ticketTypes[0]!.salesEndsAt!, -12),
    );
  }
  const liveFrom = live.registrationOpensAt;
  for (let i = 0; i < 24; i++) {
    order(
      'live',
      'general',
      int(1, 4),
      'issued',
      liveFrom,
      settled,
      i < 6 ? { promoCode: 'DHAKA15' } : {},
    );
  }
  order('live', 'general', 3, 'cancel_one', liveFrom, addDays(now, -3));
  for (let i = 0; i < 3; i++)
    order(
      'live',
      'general',
      int(1, 3),
      'pending_verification',
      addHours(now, -30),
      addHours(now, -1),
    );
  order('live', 'general', 2, 'pending_payment', addHours(now, -22.5), addHours(now, -22.5)); // hold ends within 2h
  order('live', 'general', 1, 'pending_payment', addHours(now, -8), addHours(now, -2));
  order('live', 'general', 2, 'pending_payment', addHours(now, -3), addHours(now, -1));
  for (let i = 0; i < 2; i++)
    order('live', 'general', int(1, 2), 'rejected', liveFrom, addDays(now, -1));
  for (let i = 0; i < 3; i++)
    order('live', 'general', int(1, 3), 'expired', liveFrom, addHours(now, -30));
  for (let i = 0; i < 8; i++) {
    order(
      'live',
      'vip',
      int(1, 2),
      'issued',
      liveFrom,
      settled,
      i < 2 ? { promoCode: 'VIP500' } : {},
    );
  }
  for (let i = 0; i < 2; i++)
    order('live', 'vip', 1, 'pending_verification', addHours(now, -20), addHours(now, -1));
  order('live', 'vip', 2, 'comp', addDays(now, -4), addDays(now, -2), {
    reason: 'Press — The Daily Star review, agreed with Raj',
  });

  // Monsoon Sessions: closing soon, mostly paid.
  for (let i = 0; i < 19; i++) {
    order(
      'monsoon',
      'general',
      int(1, 3),
      'issued',
      monsoon.registrationOpensAt,
      settled,
      i < 2 ? { promoCode: 'DHAKA15' } : {},
    );
  }
  order('monsoon', 'general', 2, 'pending_verification', addHours(now, -10), addHours(now, -1));
  order('monsoon', 'general', 1, 'pending_payment', addHours(now, -5), addHours(now, -1));
  order('monsoon', 'general', 2, 'comp', addDays(now, -3), addDays(now, -2), {
    reason: 'Artist guest list — Arnob',
  });

  // Poetry & Pints: sold out exactly, all paid.
  for (const q of splitExactly(60))
    order('poetry', 'general', q, 'issued', poetry.registrationOpensAt, settled);

  // Spring Fever '26: history — registration long closed, everything settled.
  const springFrom = spring.registrationOpensAt;
  const springTo = addHours(spring.registrationClosesAt, -30);
  for (let i = 0; i < 34; i++) {
    order(
      'spring',
      'general',
      int(1, 4),
      'issued',
      springFrom,
      springTo,
      i % 9 === 0 ? { promoCode: 'DHAKA15' } : {},
    );
  }
  for (let i = 0; i < 8; i++) order('spring', 'vip', int(1, 2), 'issued', springFrom, springTo);
  order('spring', 'general', 2, 'rejected', springFrom, springTo);
  for (let i = 0; i < 2; i++)
    order('spring', 'general', int(1, 2), 'expired', springFrom, springTo);

  orders.sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());

  return {
    now,
    promosAt: at(-99, 12),
    sponsorsAt: at(-40, 12),
    events,
    sponsors,
    promos: [
      { code: 'DHAKA15', type: 'percentage', value: 15, active: true, restrictTo: [] },
      {
        code: 'VIP500',
        type: 'fixed',
        value: takaToPaisa(500),
        active: true,
        restrictTo: [{ eventKey: 'live', typeKey: 'vip' }],
      },
      { code: 'EARLYFRIENDS', type: 'percentage', value: 10, active: false, restrictTo: [] },
    ],
    orders,
  };
}
