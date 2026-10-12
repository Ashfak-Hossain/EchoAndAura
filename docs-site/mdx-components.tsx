import defaults from 'fumadocs-ui/mdx';
import { Step, Steps } from 'fumadocs-ui/components/steps';
import * as Twoslash from 'fumadocs-twoslash/ui';
import type { MDXComponents } from 'mdx/types';
import { Diagram } from './components/diagram';
import { SourceLink } from './components/source-link';
import { SystemMap } from './components/system-map';
import { TicketRace } from './components/ticket-race';
import { TicketJourney } from './components/ticket-journey';

export function getMDXComponents(): MDXComponents {
  return {
    ...defaults,
    ...Twoslash,
    Step,
    Steps,
    Diagram,
    SourceLink,
    SystemMap,
    TicketRace,
    TicketJourney,
  };
}
