import { readFileSync, readdirSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { ORDER_TRANSITIONS } from '@/server/lib/order-status';
import { THEMES, stampFor } from '../../docs-site/diagrams/config.mjs';

// The docs site's diagrams are rendered ahead of time (`pnpm docs:diagrams`)
// and committed. These checks fail when a rendering is stale or a diagram
// stops telling the truth about the code it draws.
const SOURCES = 'docs-site/diagrams';
const RENDERED = 'docs-site/public/diagrams';
const names = readdirSync(SOURCES)
  .filter((file) => file.endsWith('.mmd'))
  .map((file) => file.slice(0, -4));

describe('docs diagrams', () => {
  it('has a rendering per theme for every source, made from that exact source and config', () => {
    expect(names.length).toBeGreaterThan(0);
    for (const name of names) {
      const source = readFileSync(`${SOURCES}/${name}.mmd`, 'utf8');
      for (const theme of Object.keys(THEMES)) {
        const svg = readFileSync(`${RENDERED}/${name}.${theme}.svg`, 'utf8');
        expect(svg.split('\n')[0], `${name}.${theme}.svg is stale`).toBe(
          stampFor(name, source, theme),
        );
      }
    }
  });

  it('keeps no rendering without a source', () => {
    const expected = names.flatMap((name) => Object.keys(THEMES).map((t) => `${name}.${t}.svg`));
    expect(readdirSync(RENDERED).sort()).toEqual(expected.sort());
  });

  it('draws exactly the transitions the order state machine allows', () => {
    const arrows = readFileSync(`${SOURCES}/order-states.mmd`, 'utf8')
      .split('\n')
      .map((line) => /^\s*(\w+)\s*-->\s*(\w+)/.exec(line))
      .filter((match) => match !== null)
      .map(([, from, to]) => `${from} -> ${to}`);
    const table = Object.entries(ORDER_TRANSITIONS).flatMap(([from, tos]) =>
      tos.map((to) => `${from} -> ${to}`),
    );
    expect(arrows.sort()).toEqual(table.sort());
  });
});
