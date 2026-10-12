import { DocsLayout } from 'fumadocs-ui/layouts/docs';
import { BrandLogo } from '@/components/brand-logo';
import { source } from '@/lib/source';
import type { ReactNode } from 'react';

export default function Layout({ children }: { children: ReactNode }) {
  return (
    <DocsLayout
      tree={source.pageTree}
      nav={{
        title: (
          <span className="wordmark">
            <BrandLogo className="wordmark-logo" />
            <span className="sr-only">echo&aura</span>
            <small>developer docs</small>
          </span>
        ),
      }}
      links={[
        {
          text: 'Source code',
          url: 'https://github.com/Ashfak-Hossain/EchoAndAura',
          external: true,
        },
      ]}
    >
      {children}
    </DocsLayout>
  );
}
