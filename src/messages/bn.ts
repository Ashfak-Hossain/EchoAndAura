import type { Messages } from './en';

/** ADR-061: Bangla. `satisfies Messages`: a missing or misspelt key fails the type check. */
const bn = {
  language: {
    label: 'ভাষা',
    en: 'English',
    bn: 'বাংলা',
  },
} satisfies Messages;

export default bn;
