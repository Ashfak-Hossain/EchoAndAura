import type { PolicyKey } from './types';

/**
 * The help pages as one set (Canvas 5): the policy switcher, the "Related
 * policies" row and About's fine print all read this. `description` is
 * also each page's metadata description and its header's purpose line.
 */
export const HELP_PAGES = {
  terms: {
    path: '/terms',
    tab: 'Terms',
    title: 'Terms of sale',
    description: 'The terms you agree to when you register for an event.',
  },
  privacy: {
    path: '/privacy',
    tab: 'Privacy',
    title: 'Privacy policy',
    description: 'What we collect when you buy a ticket, why, and who sees it.',
  },
  refund: {
    path: '/refund',
    tab: 'Refunds',
    title: 'Refund policy',
    description: 'When money is returned, how, and how long it takes.',
  },
  faq: {
    path: '/faq',
    tab: 'FAQ',
    title: 'FAQ',
    description: 'How tickets, bKash payment and verification work at echoandaura.',
  },
} as const;

export const POLICY_KEYS: readonly PolicyKey[] = ['terms', 'privacy', 'refund'];

export type { PolicyDoc, PolicyKey, PolicySection } from './types';
