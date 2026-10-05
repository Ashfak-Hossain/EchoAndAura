'use client';

import NextLink from 'next/link';
import type { ComponentProps } from 'react';
import { usePageLocale } from './locale-context';
import { localisedPath } from './locales';

/**
 * ADR-061: `next/link` that stays in the visitor's language — on a Bangla
 * page `/events` points to `/bn/events`. Admin, the gate and outside links
 * pass through unchanged. Public pages use this one; English-only areas
 * keep `next/link`.
 */
export function Link({ href, ...props }: ComponentProps<typeof NextLink>) {
  const locale = usePageLocale();
  const to =
    typeof href === 'string'
      ? localisedPath(href, locale)
      : href.pathname
        ? { ...href, pathname: localisedPath(href.pathname, locale) }
        : href;
  return <NextLink href={to} {...props} />;
}

export default Link;
