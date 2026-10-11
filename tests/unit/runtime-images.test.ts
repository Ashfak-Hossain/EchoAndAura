import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';

const dockerfile = readFileSync('Dockerfile', 'utf8');
/** The text of one Dockerfile stage, from its FROM line to the next. */
function stage(name: string): string {
  const start = dockerfile.search(new RegExp(`^FROM .* AS ${name}$`, 'm'));
  expect(start, `stage ${name}`).toBeGreaterThanOrEqual(0);
  const next = dockerfile.slice(start + 1).search(/^FROM /m);
  return next < 0 ? dockerfile.slice(start) : dockerfile.slice(start, start + 1 + next);
}

// Phase 9.9: what the runtime images carry is what the image scan judges.
describe('runtime image contents', () => {
  it("installs only the app's production dependencies for the worker, not the docs site's", () => {
    expect(stage('prod-deps')).toMatch(
      /pnpm install --frozen-lockfile --prod --filter echoandaura/,
    );
  });

  it('removes npm from both runtime images; they run node only', () => {
    for (const name of ['web', 'worker']) {
      expect(stage(name)).toContain('rm -rf /usr/local/lib/node_modules/npm');
      expect(stage(name)).toContain('/usr/local/bin/npx');
    }
  });

  it("keeps drizzle-kit's esbuild on the app's own version", () => {
    const { devDependencies } = JSON.parse(readFileSync('package.json', 'utf8')) as {
      devDependencies: Record<string, string>;
    };
    const { overrides } = parse(readFileSync('pnpm-workspace.yaml', 'utf8')) as {
      overrides: Record<string, string>;
    };
    // drizzle-kit reaches the worker image as better-auth's optional peer.
    expect(overrides['drizzle-kit>esbuild']).toBe(devDependencies.esbuild);
    expect(overrides['@esbuild-kit/core-utils>esbuild']).toBe(devDependencies.esbuild);
  });
});
