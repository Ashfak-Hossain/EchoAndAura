import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { FaqAccordion } from '@/components/public/faq-accordion';
import { ContactCard, type ContactSettings } from '@/components/public/static-page';
import { faqItems } from '@/content/faq';

const contact = (over: Partial<ContactSettings> = {}): ContactSettings => ({
  supportEmail: null,
  supportPhone: null,
  facebookPageUrl: null,
  organizerName: 'Raj',
  ...over,
});

describe('ContactCard', () => {
  it('renders nothing when no channel is configured', () => {
    expect(renderToStaticMarkup(createElement(ContactCard, { settings: contact() }))).toBe('');
  });

  it('shows only the channels that are set, phone as a tel: link without spaces', () => {
    const html = renderToStaticMarkup(
      createElement(ContactCard, {
        settings: contact({ supportEmail: 'hello@example.com', supportPhone: '01712 345678' }),
      }),
    );
    expect(html).toContain('Message Raj');
    expect(html).toContain('href="mailto:hello@example.com"');
    expect(html).toContain('href="tel:01712345678"');
    expect(html).toContain('01712 345678');
    expect(html).not.toContain('Facebook');
  });
});

describe('FaqAccordion', () => {
  it('renders one exclusive <details> per item with its anchor id and a link to it', () => {
    const html = renderToStaticMarkup(
      createElement(FaqAccordion, {
        items: [
          { id: 'one', question: 'First?', answer: createElement('p', null, 'A1') },
          { id: 'two', question: 'Second?', answer: createElement('p', null, 'A2') },
        ],
      }),
    );
    expect(html.match(/<details /g)).toHaveLength(2);
    expect(html).toContain('id="one"');
    expect(html).toContain('name="faq"');
    expect(html).toContain('href="#two"');
    expect(html).toContain('A2');
  });

  it('ships the FAQ with unique, URL-safe ids — they are shareable anchors', () => {
    const ids = faqItems('usually within 4 hours').map((i) => i.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids) expect(id).toMatch(/^[a-z0-9-]+$/);
    // Linked from the contact page and the order flow: must keep existing.
    expect(ids).toContain('wrong-trxid');
    expect(ids).toContain('someone-else');
  });
});
