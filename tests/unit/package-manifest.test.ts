import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';

interface Manifest {
  version: string;
  license?: string;
  engines?: Record<string, string>;
  devEngines?: { runtime?: { name: string; version: string; onFail?: string } };
  packageManager?: string;
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
}
const read = (path: string) => JSON.parse(readFileSync(path, 'utf8')) as Manifest;
const app = read('package.json');
const docs = read('docs-site/package.json');
const workspace = parse(readFileSync('pnpm-workspace.yaml', 'utf8')) as Record<string, unknown>;

// CLAUDE.md: "Pin dependency versions exactly. No ^ ranges."
describe('the package manifests', () => {
  it('pin every dependency to an exact version', () => {
    for (const manifest of [app, docs]) {
      const ranged = Object.entries({
        ...manifest.dependencies,
        ...manifest.devDependencies,
      }).filter(([, version]) => !/^\d+\.\d+\.\d+(-[\w.]+)?$/.test(version));
      expect(ranged).toEqual([]);
    }
  });

  it('keep the pnpm settings where pnpm 11 reads them, not in .npmrc', () => {
    // pnpm 11 reads only auth and registry settings from .npmrc; anything
    // else there is silently ignored, which is how save-exact once stopped working.
    expect(workspace).toMatchObject({
      saveExact: true,
      engineStrict: true,
      strictPeerDependencies: false,
    });
    expect(existsSync('.npmrc')).toBe(false);
  });

  it('require the Node in .nvmrc and the pnpm in packageManager', () => {
    const node = readFileSync('.nvmrc', 'utf8').trim();
    const pnpmMajor = /^pnpm@(\d+)\./.exec(app.packageManager ?? '')?.[1];
    // devEngines is what holds people to .nvmrc's Node: pnpm refuses
    // install and run outside it (ADR-076).
    expect(app.devEngines).toEqual({
      runtime: { name: 'node', version: `>=${node} <${Number(node) + 1}`, onFail: 'error' },
    });
    // engines stays wide enough for Dependabot's npm updater, which runs
    // Node 24 and refuses a project whose engines exclude it (ADR-076).
    expect(app.engines).toEqual({
      node: `>=24 <${Number(node) + 1}`,
      pnpm: `>=${pnpmMajor} <${Number(pnpmMajor) + 1}`,
    });
  });

  it('declare the code proprietary, as LICENSE does', () => {
    expect(app.license).toBe('UNLICENSED');
    expect(readFileSync('LICENSE', 'utf8')).toContain('All rights reserved.');
  });
});
