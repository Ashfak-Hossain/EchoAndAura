import { describe, expect, it } from 'vitest';
import { PUBLIC_NAV, headerTone, isPublicNavActive } from '@/lib/public-nav';

/** Canvas 6, N1/N2 and plan decision 7. */
const item = (label: string) => {
  const found = PUBLIC_NAV.find((i) => i.label === label);
  if (!found) throw new Error(`no nav item ${label}`);
  return found;
};

const active = (pathname: string) =>
  PUBLIC_NAV.filter((i) => isPublicNavActive(i, pathname)).map((i) => i.label);

describe('PUBLIC_NAV', () => {
  it('lists the four header links in order', () => {
    expect(PUBLIC_NAV.map((i) => [i.label, i.href])).toEqual([
      ['Events', '/events'],
      ['Past events', '/archive'],
      ['FAQ', '/faq'],
      ['Contact', '/contact'],
    ]);
  });
});

describe('isPublicNavActive', () => {
  it('Events is current on /events and on every event page', () => {
    expect(active('/events')).toEqual(['Events']);
    expect(active('/events/echo-aura-live-dhaka')).toEqual(['Events']);
    expect(active('/events/echo-aura-live-dhaka/register')).toEqual(['Events']);
  });

  it('does not match a path that merely starts with the same letters', () => {
    expect(isPublicNavActive(item('Events'), '/eventsx')).toBe(false);
    expect(isPublicNavActive(item('FAQ'), '/faq/extra')).toBe(false);
  });

  it('the other links match their page exactly', () => {
    expect(active('/archive')).toEqual(['Past events']);
    expect(active('/faq')).toEqual(['FAQ']);
    expect(active('/contact')).toEqual(['Contact']);
  });

  it('nothing is current on the home page or pages outside the nav', () => {
    expect(active('/')).toEqual([]);
    expect(active('/terms')).toEqual([]);
    expect(active('/orders/find')).toEqual([]);
  });
});

describe('headerTone', () => {
  it('is dark on the home page only', () => {
    expect(headerTone('/')).toBe('dark');
    for (const path of ['/events', '/events/x', '/faq', '/archive', '/account']) {
      expect(headerTone(path)).toBe('light');
    }
  });
});
