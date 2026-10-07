'use client';

import { useRef } from 'react';
import { useDocsSearch } from 'fumadocs-core/search/client';
import { staticClient } from 'fumadocs-core/search/client/orama-static';
import {
  SearchDialog,
  SearchDialogClose,
  SearchDialogContent,
  SearchDialogHeader,
  SearchDialogIcon,
  SearchDialogInput,
  SearchDialogList,
  SearchDialogOverlay,
} from 'fumadocs-ui/components/dialog/search';
import type { DefaultSearchDialogProps } from 'fumadocs-ui/components/dialog/search-default';

export default function StaticSearchDialog({ open, onOpenChange }: DefaultSearchDialogProps) {
  const previousFocus = useRef<HTMLElement | null>(null);
  const { search, setSearch, query } = useDocsSearch({
    client: staticClient({ from: '/api/search' }),
  });
  return (
    <SearchDialog
      open={open}
      onOpenChange={onOpenChange}
      search={search}
      onSearchChange={setSearch}
      isLoading={query.isLoading}
    >
      <SearchDialogOverlay />
      <SearchDialogContent
        onOpenAutoFocus={() => {
          previousFocus.current =
            document.activeElement instanceof HTMLElement ? document.activeElement : null;
        }}
        onCloseAutoFocus={(event) => {
          // The search buttons live outside Radix's DialogTrigger. Restore
          // their focus explicitly so Escape preserves keyboard position.
          event.preventDefault();
          if (previousFocus.current?.isConnected) previousFocus.current.focus();
        }}
      >
        <SearchDialogHeader>
          <SearchDialogIcon />
          <SearchDialogInput />
          <SearchDialogClose />
        </SearchDialogHeader>
        <SearchDialogList items={query.data === 'empty' ? null : query.data} />
      </SearchDialogContent>
    </SearchDialog>
  );
}
