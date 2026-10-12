import type { BaseLayoutProps } from 'fumadocs-ui/layouts/shared';
import { BrandLogo } from '@/components/brand-logo';

export const SOURCE_URL = 'https://github.com/Ashfak-Hossain/EchoAndAura';

/** The nav shared by the home page and the docs pages. */
export function baseOptions(): BaseLayoutProps {
  return {
    nav: {
      title: (
        <span className="wordmark">
          <BrandLogo className="wordmark-logo" />
          <span className="sr-only">echo&aura</span>
          <small>developer docs</small>
        </span>
      ),
    },
    links: [{ text: 'Source code', url: SOURCE_URL, external: true }],
  };
}
