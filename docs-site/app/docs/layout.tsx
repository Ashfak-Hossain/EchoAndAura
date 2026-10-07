import { DocsLayout } from 'fumadocs-ui/layouts/docs';
import { source } from '@/lib/source';
import type { ReactNode } from 'react';

export default function Layout({ children }: { children: ReactNode }) {
  return (
    <DocsLayout
      tree={source.pageTree}
      nav={{
        title: (
          <span className="wordmark">
            echo<span>&</span>aura <small>developer docs</small>
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
