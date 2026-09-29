import { Fragment, createElement as h } from 'react';
import { describe, expect, it } from 'vitest';
import { nodeText } from '@/lib/node-text';

// A component like next/link: a function type, so it counts as inline.
function Link({ children }: { href: string; children: string }) {
  return h('a', null, children);
}

describe('nodeText (FAQ answers as plain text, ADR-042)', () => {
  it('reads through elements, fragments and components; paragraphs become spaces', () => {
    const answer = h(
      Fragment,
      null,
      h(
        'p',
        null,
        'Open your order page (or ',
        h(Link, { href: '/orders/find', children: 'Find my order' }),
        ') and check the ',
        h('strong', null, 'status'),
        '.',
      ),
      h('p', null, 'Then submit again.'),
    );
    expect(nodeText(answer)).toBe(
      'Open your order page (or Find my order) and check the status. Then submit again.',
    );
  });

  it('ignores nothing-values and keeps numbers', () => {
    expect(nodeText([null, undefined, false, 'Holds last ', 24, ' hours'])).toBe(
      'Holds last 24 hours',
    );
  });
});
