import defaults from 'fumadocs-ui/mdx';
import * as Twoslash from 'fumadocs-twoslash/ui';
import type { MDXComponents } from 'mdx/types';
import { SourceLink } from './components/source-link';
import { SystemMap } from './components/system-map';
import { TicketRace } from './components/ticket-race';
import { TicketJourney } from './components/ticket-journey';

export function getMDXComponents(): MDXComponents {
  return { ...defaults, ...Twoslash, SourceLink, SystemMap, TicketRace, TicketJourney };
}
