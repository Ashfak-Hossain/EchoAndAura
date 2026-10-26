import { createHash } from 'node:crypto';
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

  // ADR-087: one licence, said the same way wherever a tool or a reader
  // looks for it. LICENSE stays the bare FSF text so GitHub detects it.
  it('declare AGPL-3.0-only, as LICENSE, TRADEMARKS.md and both images do', () => {
    expect(app.license).toBe('AGPL-3.0-only');
    expect(docs.license).toBe('AGPL-3.0-only');

    // sha256 of https://www.gnu.org/licenses/agpl-3.0.txt (2026-10-26): any
    // added line could stop GitHub and Scorecard detecting it.
    expect(createHash('sha256').update(readFileSync('LICENSE')).digest('hex')).toBe(
      '0d96a4ff68ad6d4b6f1f30f713b18d5184912ba8dd389f86aa7710db079abcb0',
    );

    // The brand exclusion must name files that still exist.
    const trademarks = readFileSync('TRADEMARKS.md', 'utf8');
    expect(trademarks).toContain('`AGPL-3.0-only`');
    const listed = [
      ...[...trademarks.matchAll(/\]\(([^)#:]+)\)/g)].map((m) => m[1] ?? ''),
      ...[...trademarks.matchAll(/`([\w.-]+\/[\w./-]+)`/g)].map((m) => m[1] ?? ''),
    ];
    expect(listed).toContain('src/lib/brand/marks.ts');
    for (const path of listed) expect(existsSync(path), path).toBe(true);

    const stages = readFileSync('Dockerfile', 'utf8').split(/^FROM /m);
    for (const name of ['web', 'worker']) {
      const stage = stages.find((s) => s.split('\n')[0]?.endsWith(` AS ${name}`)) ?? '';
      expect(stage.match(/^LABEL org\.opencontainers\.image\.licenses=.*$/gm), name).toEqual([
        'LABEL org.opencontainers.image.licenses=AGPL-3.0-only',
      ]);
      expect(stage, name).toContain('COPY LICENSE TRADEMARKS.md ./\n');
    }
  });
});
