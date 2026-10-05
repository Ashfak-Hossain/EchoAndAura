import { describe, expect, it } from 'vitest';
import {
  isEnglishOnly,
  localeFromPath,
  localeStep,
  localisedPath,
  publicLocales,
} from '@/i18n/locales';
import bn from '@/messages/bn';
import en from '@/messages/en';

const ON = ['en', 'bn'] as const;
const OFF = ['en'] as const;
const step = (pathname: string, extra: Partial<Parameters<typeof localeStep>[0]> = {}) =>
  localeStep({ pathname, search: '', method: 'GET', cookie: undefined, locales: ON, ...extra });

describe('public languages (ADR-061)', () => {
  it('PUBLIC_LOCALES: English always, Bangla only when named, typos ignored', () => {
    expect(publicLocales(undefined)).toEqual(['en']);
    expect(publicLocales('en,bn')).toEqual(['en', 'bn']);
    expect(publicLocales(' bn ')).toEqual(['en', 'bn']);
    expect(publicLocales('en,bangla')).toEqual(['en']);
  });

  it('reads the language from the path', () => {
    expect(localeFromPath('/bn')).toEqual({ locale: 'bn', path: '/' });
    expect(localeFromPath('/bn/events/x')).toEqual({ locale: 'bn', path: '/events/x' });
    expect(localeFromPath('/bnx')).toEqual({ locale: 'en', path: '/bnx' });
    expect(localeFromPath('/events')).toEqual({ locale: 'en', path: '/events' });
  });

  it('links stay in the language; admin, the gate, files and outside links never change', () => {
    expect(localisedPath('/', 'bn')).toBe('/bn');
    expect(localisedPath('/events/x?y=1#t', 'bn')).toBe('/bn/events/x?y=1#t');
    expect(localisedPath('/bn/events', 'bn')).toBe('/bn/events');
    expect(localisedPath('/events', 'en')).toBe('/events');
    for (const href of ['/admin', '/door', '/api/x', '/robots.txt', 'https://x.test/a', '#top']) {
      expect(localisedPath(href, 'bn')).toBe(href);
    }
    expect(localisedPath('//evil.test/x', 'bn')).toBe('//evil.test/x');
    expect(isEnglishOnly('/icon')).toBe(true);
  });

  it('the proxy step: /bn is rewritten when on, a 404 when off', () => {
    expect(step('/bn/events/x')).toEqual({ kind: 'rewrite', locale: 'bn', path: '/events/x' });
    expect(step('/bn')).toEqual({ kind: 'rewrite', locale: 'bn', path: '/' });
    expect(step('/bn/events/x', { locales: OFF })).toEqual({ kind: 'next', locale: 'en' });
    expect(step('/events')).toEqual({ kind: 'next', locale: 'en' });
  });

  it('a visitor who chose Bangla is sent to /bn once — page views only, never admin or off-site', () => {
    expect(step('/events', { cookie: 'bn', search: '?p=2' })).toEqual({
      kind: 'redirect',
      to: '/bn/events?p=2',
    });
    expect(step('/', { cookie: 'bn' })).toEqual({ kind: 'redirect', to: '/bn' });
    expect(step('/events', { cookie: 'bn', locales: OFF }).kind).toBe('next');
    expect(step('/events', { cookie: 'bn', method: 'POST' }).kind).toBe('next');
    expect(step('/events', { cookie: 'en' }).kind).toBe('next');
    expect(step('/admin/orders', { cookie: 'bn' }).kind).toBe('next');
    expect(step('/door', { cookie: 'bn' }).kind).toBe('next');
    expect(step('//evil.test/x', { cookie: 'bn' }).kind).toBe('next');
  });

  it('the Bangla catalogue has exactly the English keys', () => {
    const keys = (o: object, prefix = ''): string[] =>
      Object.entries(o).flatMap(([k, v]) =>
        typeof v === 'object' && v !== null ? keys(v, `${prefix}${k}.`) : [`${prefix}${k}`],
      );
    expect(keys(bn).sort()).toEqual(keys(en).sort());
  });
});
