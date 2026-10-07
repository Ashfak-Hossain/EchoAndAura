import defaults from 'fumadocs-ui/mdx';
import type { MDXComponents } from 'mdx/types';
import { SourceLink } from './components/source-link';
import { SystemMap } from './components/system-map';

export function getMDXComponents(): MDXComponents {
  return { ...defaults, SourceLink, SystemMap };
}
