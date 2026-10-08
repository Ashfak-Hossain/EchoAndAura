import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { parse } from 'yaml';

const fs = vi.hoisted(() => ({
  readFile: vi.fn(),
  readdir: vi.fn(),
  unlink: vi.fn(),
  writeFile: vi.fn(),
}));
vi.mock('node:fs/promises', () => fs);
import {
  sourceMapSettings,
  injectNextMaps,
  finishImageMaps,
} from '../../scripts/error-tracking-build.mjs';
const env = {
  SENTRY_BUILD_SOURCEMAPS: '1',
  SENTRY_ORG: 'echo-aura',
  SENTRY_PROJECT: 'app',
  SENTRY_AUTH_TOKEN: 'synthetic-upload-credential',
};
beforeEach(() => {
  vi.clearAllMocks();
  fs.readFile.mockResolvedValue(JSON.stringify({ revision: 'b'.repeat(40) }));
  fs.readdir.mockResolvedValue([
    { name: 'chunk.js.map', isDirectory: () => false, isFile: () => true },
    { name: 'chunk.js', isDirectory: () => false, isFile: () => true },
    { name: 'symlink.map', isDirectory: () => false, isFile: () => false },
  ]);
  fs.unlink.mockResolvedValue(undefined);
});
afterEach(() => {
  vi.unstubAllEnvs();
});

describe('private source-map build', () => {
  it('requires explicit opt-in and complete settings, with safe errors', () => {
    expect(sourceMapSettings({})).toBeNull();
    expect(sourceMapSettings(env)).toEqual({ org: 'echo-aura', project: 'app' });
    expect(() => sourceMapSettings({ ...env, SENTRY_AUTH_TOKEN: '' })).toThrow(
      'BuildKit upload credential',
    );
    expect(() => sourceMapSettings({ ...env, SENTRY_ORG: '../unsafe' })).toThrow();
  });
  it('injects the exact Next build output before standalone tracing, not arbitrary paths', async () => {
    const run = vi.fn<(args: string[]) => Promise<void>>(async () => {});
    await injectNextMaps('.next-build', env, run);
    expect(run).toHaveBeenCalledExactlyOnceWith([
      'sourcemaps',
      'inject',
      resolve('.next-build/static'),
      resolve('.next-build/server'),
    ]);
    await expect(injectNextMaps('/', env, run)).rejects.toThrow('isolated .next-build');
    fs.readFile.mockResolvedValueOnce('//# sourceMappingURL=..%2Foutside.map');
    await expect(injectNextMaps('.next-build', env, run)).rejects.toThrow(
      'local generated source-map filename',
    );
    fs.readFile
      .mockResolvedValueOnce('//# sourceMappingURL=%5Bchunk%5D.js.map')
      .mockRejectedValueOnce(new Error('missing generated map'));
    await expect(injectNextMaps('.next-build', env, run)).rejects.toThrow('missing generated map');
    expect(run).toHaveBeenCalledTimes(1);
    expect(fs.writeFile).not.toHaveBeenCalled();
  });
  it('uploads using image metadata and private credentials, then strips only maps that ship', async () => {
    const run = vi.fn<(args: string[]) => Promise<void>>(async () => {});
    await finishImageMaps(env, run);
    expect(run.mock.calls[0]?.[0]).toEqual([
      'sourcemaps',
      'inject',
      'dist/worker.mjs',
      'dist/worker.mjs.map',
    ]);
    const command = run.mock.calls[1]?.[0];
    expect(command).toContain('b'.repeat(40));
    expect(command).toContain('--strict');
    expect(command).not.toContain(env.SENTRY_AUTH_TOKEN);
    expect(fs.unlink.mock.calls.map(([path]) => path)).toEqual([
      '.next-build/static/chunk.js.map',
      '.next-build/server/chunk.js.map',
      '.next-build/standalone/.next-build/server/chunk.js.map',
      'dist/worker.mjs.map',
    ]);
  });
  it('fails before publishing if maps cannot upload or the revision is invalid', async () => {
    const run = vi
      .fn<(args: string[]) => Promise<void>>()
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new Error('upload failed'));
    await expect(finishImageMaps(env, run)).rejects.toThrow('upload failed');
    expect(fs.unlink).not.toHaveBeenCalled();
    fs.readFile.mockResolvedValueOnce('{"revision":"main"}');
    await expect(finishImageMaps(env, run)).rejects.toThrow('image-owned');
  });
  it('never uploads by default, and still strips runtime maps', async () => {
    const run = vi.fn<(args: string[]) => Promise<void>>(async () => {});
    await finishImageMaps({}, run);
    expect(run).not.toHaveBeenCalled();
    expect(fs.readFile).not.toHaveBeenCalled();
    expect(fs.unlink).toHaveBeenCalledTimes(4);
  });
});

describe('build/runtime configuration contract', () => {
  it('passes only public build args and uses a BuildKit secret on both images', () => {
    const workflow = parse(readFileSync('.github/workflows/deploy.yml', 'utf8'));
    const builds = workflow.jobs.images.steps.filter(
      (step: { name?: string }) => step.name === 'Build web' || step.name === 'Build worker',
    );
    expect(builds).toHaveLength(2);
    for (const build of builds) {
      expect(build.with['build-args']).toContain('NEXT_PUBLIC_SENTRY_DSN=');
      expect(build.with['build-args']).not.toContain('SENTRY_AUTH_TOKEN');
      expect(build.with.secrets).toBe('sentry_auth_token=${{ secrets.SENTRY_AUTH_TOKEN }}\n');
    }
    const dockerfile = readFileSync('Dockerfile', 'utf8');
    expect(dockerfile).toContain('# syntax=docker/dockerfile:1.10');
    expect(dockerfile).toContain('--mount=type=secret,id=sentry_auth_token,env=SENTRY_AUTH_TOKEN');
    expect(dockerfile).not.toMatch(/(?:ARG|ENV) SENTRY_AUTH_TOKEN/);
    const compose = parse(readFileSync('docker-compose.prod.yml', 'utf8'), { merge: true });
    expect(compose.services.web.environment.SENTRY_DSN).toBe('${SENTRY_DSN:-}');
    expect(compose.services.worker.environment.SENTRY_DSN).toBe('${SENTRY_DSN:-}');
    expect(compose.services.migrate.environment.SENTRY_DSN).toBeUndefined();
  });
});
