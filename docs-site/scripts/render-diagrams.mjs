// Renders diagrams/*.mmd to public/diagrams/<name>.<theme>.svg in both themes:
// `pnpm docs:diagrams`. Mermaid needs a browser to measure text, so this uses
// the Playwright Chromium the docs tests already install, and the pinned
// mermaid package from node_modules. Nothing is fetched from the network.
import { readFile, readdir, writeFile, mkdir } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { chromium } from '@playwright/test';
import { THEMES, stampFor } from '../diagrams/config.mjs';

const require = createRequire(import.meta.url);
const mermaidBundle = require.resolve('mermaid/dist/mermaid.min.js');
const names = (await readdir('diagrams'))
  .filter((file) => file.endsWith('.mmd'))
  .map((file) => file.slice(0, -4));

await mkdir('public/diagrams', { recursive: true });
const browser = await chromium.launch();
try {
  const page = await browser.newPage();
  await page.setContent('<!doctype html><html><body></body></html>');
  await page.addScriptTag({ path: mermaidBundle });
  for (const name of names) {
    const source = await readFile(join('diagrams', `${name}.mmd`), 'utf8');
    for (const theme of Object.keys(THEMES)) {
      const svg = await page.evaluate(
        async ({ source, config, id }) => {
          // @ts-expect-error: the bundle defines a global.
          const mermaid = globalThis.mermaid;
          mermaid.initialize(config);
          return (await mermaid.render(id, source)).svg;
        },
        { source, config: THEMES[theme], id: `${name}-${theme}` },
      );
      // An <img> needs an intrinsic size: give the SVG its viewBox's.
      const [, , width, height] = /viewBox="([^"]+)"/.exec(svg)[1].split(/\s+/).map(Number);
      const root = /^<svg[^>]*>/.exec(svg)[0];
      const sized = svg.replace(
        root,
        root
          .replace(/ (width|height)="[^"]*"/g, '')
          .replace(/ style="[^"]*"/, '')
          .replace('<svg', `<svg width="${Math.ceil(width)}" height="${Math.ceil(height)}"`),
      );
      await writeFile(
        join('public/diagrams', `${name}.${theme}.svg`),
        `${stampFor(name, source, theme)}\n${sized}\n`,
      );
      console.log(`${name}.${theme}.svg: ${Math.ceil(width)}x${Math.ceil(height)}`);
    }
  }
} finally {
  await browser.close();
}
