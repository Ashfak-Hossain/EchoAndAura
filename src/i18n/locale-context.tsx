'use client';

import { createContext, type ReactNode, useContext } from 'react';
import { DEFAULT_LOCALE, type Locale } from './locales';

/**
 * ADR-061: the page's language for links. English when nothing provides it
 * (admin, the gate, a component rendered on its own in a test).
 */
const LocaleContext = createContext<Locale>(DEFAULT_LOCALE);

export function LocaleProvider({ locale, children }: { locale: Locale; children: ReactNode }) {
  return <LocaleContext value={locale}>{children}</LocaleContext>;
}

export function usePageLocale(): Locale {
  return useContext(LocaleContext);
}
