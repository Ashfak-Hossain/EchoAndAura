import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { ReactNode } from 'react';

const DIR = join(process.cwd(), 'public/diagrams');

/** The rendered SVG's size, so the image holds its space before it loads. */
function size(file: string): { width: number; height: number } {
  // A missing file fails the build: run `pnpm docs:diagrams`.
  const match = /<svg width="(\d+)" height="(\d+)"/.exec(readFileSync(join(DIR, file), 'utf8'));
  if (!match) throw new Error(`Diagram has no size: ${file}. Run pnpm docs:diagrams.`);
  return { width: Number(match[1]), height: Number(match[2]) };
}

/**
 * A Mermaid diagram from diagrams/<name>.mmd, rendered ahead of time in both
 * themes (scripts/render-diagrams.mjs). CSS shows the one matching the site's
 * theme; each opens full size, for dense diagrams on a phone. `alt` says in
 * words what the picture shows; the caption explains how to read it.
 */
export function Diagram({
  name,
  alt,
  children,
}: {
  name: string;
  alt: string;
  children?: ReactNode;
}) {
  return (
    <figure className="diagram">
      {(['light', 'dark'] as const).map((theme) => {
        const file = `${name}.${theme}.svg`;
        const { width, height } = size(file);
        return (
          <a key={theme} href={`/diagrams/${file}`} className={`diagram-${theme}`}>
            {/* eslint-disable-next-line @next/next/no-img-element -- a static SVG; no optimizer in a static export */}
            <img src={`/diagrams/${file}`} alt={alt} width={width} height={height} />
          </a>
        );
      })}
      {children ? <figcaption>{children}</figcaption> : null}
    </figure>
  );
}
