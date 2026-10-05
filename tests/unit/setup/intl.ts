import { vi } from 'vitest';
import { createTranslator } from 'use-intl/core';
import type { Locale } from '@/i18n/locales';
import bn from '@/messages/bn';
import en from '@/messages/en';

/**
 * ADR-061: components read their text through next-intl, which needs a
 * request (server) or a provider (client). Unit tests render components on
 * their own, so both entry points are replaced by the real catalogue —
 * English unless a test calls `useTestLocale('bn')`.
 */
const state: { locale: Locale } = { locale: 'en' };

export function useTestLocale(locale: Locale): void {
  state.locale = locale;
}

function translator(namespace?: string) {
  return createTranslator({
    locale: state.locale,
    messages: state.locale === 'bn' ? bn : en,
    namespace: namespace as never,
    timeZone: 'Asia/Dhaka',
  });
}

vi.mock('next-intl', () => ({
  useTranslations: (namespace?: string) => translator(namespace),
  useLocale: () => state.locale,
  NextIntlClientProvider: ({ children }: { children: unknown }) => children,
}));

vi.mock('next-intl/server', () => ({
  getTranslations: async (arg?: string | { namespace?: string }) =>
    translator(typeof arg === 'string' ? arg : arg?.namespace),
  getLocale: async () => state.locale,
}));
