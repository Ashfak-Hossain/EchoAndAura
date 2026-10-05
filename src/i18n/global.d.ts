import type { Messages } from '@/messages/en';
import type { Locale } from './locales';

// next-intl's typed keys: `t('language.bn')` is checked against en.ts.
declare module 'next-intl' {
  interface AppConfig {
    Locale: Locale;
    Messages: Messages;
  }
}
