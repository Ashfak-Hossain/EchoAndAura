'use client';

import { lazy, type ReactNode } from 'react';
import { RootProvider } from 'fumadocs-ui/provider/next';

const SearchDialog = lazy(() => import('./search-dialog'));

export function Providers({ children }: { children: ReactNode }) {
  return <RootProvider search={{ SearchDialog, preload: false }}>{children}</RootProvider>;
}
