import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { FaqAccordion } from '@/components/public/faq-accordion';
import {
  type ContactSettings,
  ContactCard,
  ContactChannels,
} from '@/components/public/help/contact';
import { PolicyPage, PolicySwitcher } from '@/components/public/help/policy-page';
import { FAQ_TOPICS, faqItems } from '@/content/faq';
import { HELP_PAGES, POLICY_KEYS } from '@/content/policies';
import { privacy } from '@/content/policies/privacy';
import { refund } from '@/content/policies/refund';
import { terms } from '@/content/policies/terms';

const contact = (over: Partial<ContactSettings> = {}): ContactSettings => ({
  supportEmail: null,
  supportPhone: null,
  facebookPageUrl: null,
  organizerName: 'Raj',
  ...over,
});
const html = (el: Parameters<typeof renderToStaticMarkup>[0]) => renderToStaticMarkup(el);

describe('ContactCard and ContactChannels', () => {
  it('say contact details are being set up when no channel is configured', () => {
    for (const el of [
      createElement(ContactCard, { settings: contact() }),
      createElement(ContactChannels, { settings: contact() }),
    ]) {
      expect(html(el)).toContain('Contact details are being set up');
    }
  });

  it('show only the channels that are set, phone as a tel: link without spaces', () => {
    const settings = contact({ supportEmail: 'hello@example.com', supportPhone: '01712 345678' });
    const card = html(createElement(ContactCard, { settings }));
    expect(card).toContain('Message Raj');
    expect(card).toContain('href="mailto:hello@example.com"');
    expect(card).toContain('href="tel:01712345678"');
    expect(card).toContain('01712 345678');
    expect(card).not.toContain('Facebook');
    const cards = html(createElement(ContactChannels, { settings }));
    expect(cards.match(/href="(mailto|tel):/g)).toHaveLength(2);
    expect(cards).toContain('Raj replies within a day.');
  });
});

describe('policy content (Canvas 5)', () => {
  const docs = [terms, privacy, refund];

  it('gives every section a unique, URL-safe anchor', () => {
    for (const doc of docs) {
      const ids = doc.sections.map((s) => s.id);
      expect(new Set(ids).size).toBe(ids.length);
      for (const id of ids) expect(id).toMatch(/^[a-z0-9-]+$/);
      expect(doc.shortVersion.length).toBeGreaterThanOrEqual(3);
      expect(doc.shortVersion.length).toBeLessThanOrEqual(5);
    }
    expect(terms.sections.map((s) => s.id)).toContain('names-and-transfers');
  });

  it('renders the table of contents from the same list as the sections', () => {
    const page = html(
      createElement(PolicyPage, {
        doc: terms,
        lastUpdated: new Date('2026-09-24T00:00:00+06:00'),
        host: 'echoandaura.com',
        settings: contact(),
      }),
    );
    for (const [i, s] of terms.sections.entries()) {
      expect(page).toContain(`id="${s.id}"`);
      expect(page.split(`href="#${s.id}"`).length - 1).toBeGreaterThanOrEqual(2); // TOCs + anchor
      expect(page).toContain(`Copy link to section ${i + 1}`);
    }
    expect(page).toContain('echoandaura · echoandaura.com/terms'); // the print-only line
    expect(page.match(/role="note"/g)).toHaveLength(4); // names, door, hold, refunds
  });

  it('never tells people door staff can see their phone digits', () => {
    const page = html(
      createElement(PolicyPage, {
        doc: privacy,
        lastUpdated: new Date(),
        host: 'echoandaura.com',
        settings: contact(),
      }),
    );
    // The digits row of "What door staff see" says they are never shown.
    expect(page).toMatch(
      /last 3 digits of the phone that bought the ticket<\/th><td[^>]*>Never shown/,
    );
  });

  it('marks the current policy in the switcher', () => {
    const nav = html(createElement(PolicySwitcher, { current: 'privacy' }));
    for (const k of POLICY_KEYS) expect(nav).toContain(`href="${HELP_PAGES[k].path}"`);
    expect(nav.match(/aria-current="page"/g)).toHaveLength(1);
    expect(nav).toMatch(/<a[^>]*aria-current="page"[^>]*>Privacy</);
  });
});

describe('FAQ', () => {
  const items = faqItems('usually within 4 hours');

  it('renders one exclusive <details> per item with its anchor id and a link to it', () => {
    const out = html(
      createElement(FaqAccordion, {
        items: [
          { id: 'one', question: 'First?', answer: createElement('p', null, 'A1') },
          { id: 'two', question: 'Second?', answer: createElement('p', null, 'A2') },
        ],
      }),
    );
    expect(out.match(/<details /g)).toHaveLength(2);
    expect(out).toContain('id="one"');
    expect(out).toContain('name="faq"');
    expect(out).toContain('href="#two"');
    expect(out).toContain('A2');
  });

  it('ships unique, URL-safe ids — they are shareable anchors', () => {
    const ids = items.map((i) => i.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids) expect(id).toMatch(/^[a-z0-9-]+$/);
    // Linked from the contact page, the refund policy and the order flow.
    expect(ids).toEqual(expect.arrayContaining(['wrong-trxid', 'someone-else', 'screenshot']));
  });

  it('puts every question under a known topic, and every topic has questions', () => {
    const known = new Set<string>(FAQ_TOPICS.map((t) => t.id));
    for (const i of items) expect(known.has(i.topic)).toBe(true);
    const counts = FAQ_TOPICS.map((t) => items.filter((i) => i.topic === t.id).length);
    expect(counts).toEqual([3, 2, 2, 1]);
    // Topic anchors live on the same page as answer anchors: no clashes.
    const all = [...FAQ_TOPICS.map((t) => t.id), ...items.map((i) => i.id)];
    expect(new Set(all).size).toBe(all.length);
  });
});
