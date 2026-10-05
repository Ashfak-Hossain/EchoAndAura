import { z } from 'zod';
import { LOCALES } from '@/i18n/locales';

/** ADR-061: the switch posts a language and the page it was on (a site path, never a URL). */
export const languageSwitchSchema = z.object({
  locale: z.enum(LOCALES),
  path: z
    .string()
    .max(512)
    .regex(/^\/(?!\/)[^\s\\]*$/),
});
