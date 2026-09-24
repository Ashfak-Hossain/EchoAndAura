import type { ReactNode } from 'react';

/**
 * A policy page as data (Canvas 5): the table of contents, the numbered
 * sections, the anchors and the printed page all come from one list, so
 * they cannot drift apart. Section ids are shareable anchors
 * (`/terms#names-and-transfers`) — permanent once published.
 */
export interface PolicySection {
  id: string;
  title: string;
  /** Prose, and any `<Callout>` for a rule stated in this section. */
  body: ReactNode;
}

export type PolicyKey = 'terms' | 'privacy' | 'refund';

export interface PolicyDoc {
  key: PolicyKey;
  /** Plain-language points restating the sections below — never a new promise. */
  shortVersion: ReactNode[];
  /** The paragraph before section 1. */
  intro: ReactNode;
  sections: PolicySection[];
  /** Title of the closing contact card. */
  contactTitle: string;
}
