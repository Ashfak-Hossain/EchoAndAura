import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { ErrorPage, errorReference, randomReference } from '@/components/error-page';

describe('errorReference', () => {
  it('uses the first 8 characters of a Next digest, uppercased, never the fallback', () => {
    expect(errorReference('2056231419', () => 'NOPE')).toBe('ERR-20562314');
    expect(errorReference('a1b2c3d4e5f6', () => 'NOPE')).toBe('ERR-A1B2C3D4');
  });

  it('falls back (once, via the caller) when there is no usable digest', () => {
    let calls = 0;
    const fallback = () => {
      calls++;
      return 'K7M2Q';
    };
    expect(errorReference(undefined, fallback)).toBe('ERR-K7M2Q');
    expect(errorReference('', fallback)).toBe('ERR-K7M2Q');
    expect(errorReference('--!', fallback)).toBe('ERR-K7M2Q');
    expect(calls).toBe(3);
  });
});

describe('randomReference', () => {
  it('is five characters from the unambiguous alphabet', () => {
    for (let i = 0; i < 50; i++)
      expect(randomReference()).toMatch(/^[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{5}$/);
    expect(randomReference(() => 0)).toBe('AAAAA');
    expect(randomReference(() => 0.999999)).toBe('99999');
  });
});

describe('ErrorPage', () => {
  it('reassures about money first, shows the reference, and renders the given actions', () => {
    const html = renderToStaticMarkup(
      createElement(ErrorPage, {
        reference: 'ERR-8K2M4',
        actions: createElement('a', { href: '/contact' }, 'Message the organizer'),
      }),
    );
    expect(html).toContain('no payment was affected');
    expect(html).toContain('data-testid="error-reference"');
    expect(html).toContain('ERR-8K2M4');
    expect(html).toContain('quote this if you get in touch');
    expect(html).toContain('href="/contact"');
  });
});
