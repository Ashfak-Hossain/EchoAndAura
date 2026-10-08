import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { parse } from 'yaml';
import {
  isConfirmedDeployment,
  isHealthyDeployment,
  readHealthyDeploymentRevision,
  waitForDeployment,
} from '../../.github/scripts/deploy-confirm.mjs';

const sha = 'a'.repeat(40);
const url = 'https://example.com/api/deployment';
const headers = { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' };
const response = (revision = sha, ready = true) =>
  new Response(JSON.stringify({ revision, ready }), { headers });

describe('bounded, read-only deployment confirmation', () => {
  it('reads a healthy revision without requiring an expected commit', async () => {
    expect(isHealthyDeployment({ revision: sha, ready: true })).toBe(true);
    expect(isHealthyDeployment({ revision: sha, ready: false })).toBe(false);
    await expect(
      readHealthyDeploymentRevision({
        url,
        fetchImpl: async () => response(),
      }),
    ).resolves.toBe(sha);
    await expect(
      readHealthyDeploymentRevision({
        url,
        fetchImpl: async () => response(sha, false),
      }),
    ).rejects.toThrow('evidence unavailable');
  });
  it('accepts only the exact public contract and expected full revision', () => {
    expect(isConfirmedDeployment({ revision: sha, ready: true }, sha)).toBe(true);
    for (const value of [
      null,
      [],
      {},
      { revision: sha, ready: false },
      { revision: 'b'.repeat(40), ready: true },
      { revision: 'main', ready: true },
      { revision: sha, ready: 'true' },
      { revision: sha, ready: true, secret: 'private' },
    ])
      expect(isConfirmedDeployment(value, sha)).toBe(false);
  });
  it('uses GET without credentials, redirects or caching', async () => {
    const fetchImpl: typeof fetch = async (_url, init) => {
      expect(_url).toBe(url);
      expect(init?.redirect).toBe('error');
      expect(init?.cache).toBe('no-store');
      expect(init?.headers).toEqual({ Accept: 'application/json' });
      expect(init?.method).toBeUndefined();
      return response();
    };
    expect(await waitForDeployment({ url, revision: sha, fetchImpl })).toBe(sha);
  });
  it('waits through old or mixed revisions, then confirms the expected revision', async () => {
    let attempts = 0;
    let time = 0;
    const fetchImpl = async () =>
      ++attempts === 1
        ? response('b'.repeat(40))
        : attempts === 2
          ? response(sha, false)
          : response();
    await expect(
      waitForDeployment({
        url,
        revision: sha,
        fetchImpl,
        now: () => time,
        sleep: async (ms: number) => {
          time += ms;
        },
        intervalMs: 10,
        timeoutMs: 50,
      }),
    ).resolves.toBe(sha);
    expect(attempts).toBe(3);
  });
  it('rejects cached, malformed, oversized, unhealthy and private responses without leaking them', async () => {
    for (const create of [
      () =>
        new Response(JSON.stringify({ revision: sha, ready: true }), {
          headers: { 'Content-Type': 'application/json' },
        }),
      () => new Response('private password server-address', { status: 503 }),
      () => new Response('{private', { headers }),
      () => new Response('x'.repeat(1025), { headers }),
      () =>
        new Response(JSON.stringify({ revision: sha, ready: true }), {
          headers: { ...headers, 'Cache-Control': 'extension-no-store' },
        }),
      () => response('b'.repeat(40)),
    ]) {
      let time = 0;
      await expect(
        waitForDeployment({
          url,
          revision: sha,
          fetchImpl: async () => create(),
          now: () => time,
          sleep: async (ms: number) => {
            time += ms;
          },
          intervalMs: 10,
          timeoutMs: 20,
        }),
      ).rejects.toThrow('expected healthy revision was not confirmed');
    }
  });
  it('bounds even a request that never answers', async () => {
    const started = performance.now();
    await expect(
      waitForDeployment({
        url,
        revision: sha,
        fetchImpl: () => new Promise<Response>(() => undefined),
        timeoutMs: 20,
        requestTimeoutMs: 5,
        intervalMs: 1,
      }),
    ).rejects.toThrow('not confirmed');
    expect(performance.now() - started).toBeLessThan(1000);
  });
  it('bounds a response body that never finishes and hides network errors', async () => {
    for (const fetchImpl of [
      async () => new Response(new ReadableStream(), { headers }),
      async (): Promise<Response> => {
        throw new Error('private password host');
      },
    ]) {
      await expect(
        waitForDeployment({
          url,
          revision: sha,
          fetchImpl,
          timeoutMs: 20,
          requestTimeoutMs: 5,
          intervalMs: 1,
        }),
      ).rejects.toThrow('expected healthy revision was not confirmed');
    }
  });
  it('refuses unsafe endpoints, tags and unbounded configurations', async () => {
    for (const changes of [
      { url: 'http://example.com/api/deployment' },
      { url: 'https://user:password@example.com/api/deployment' },
      { url: `${url}?secret=private` },
      { url: `${url}#fragment` },
      { revision: 'main' },
      { timeoutMs: 0 },
      { timeoutMs: 600001 },
      { intervalMs: -1 },
      { requestTimeoutMs: 60001 },
    ])
      await expect(waitForDeployment({ url, revision: sha, ...changes })).rejects.toThrow(
        'configuration',
      );
    await expect(
      waitForDeployment({
        url: 'http://127.0.0.1:3000/api/deployment',
        revision: sha,
        fetchImpl: async () => response(),
      }),
    ).resolves.toBe(sha);
  });
});

describe('production workflow contract', () => {
  const workflow = parse(readFileSync('.github/workflows/deploy.yml', 'utf8'));
  const steps = workflow.jobs.images.steps;
  it('stamps both images and tests the same expected revision before push', () => {
    for (const name of ['Build web', 'Build worker'])
      expect(
        steps.find((step: { name?: string }) => step.name === name).with['build-args'],
      ).toContain('SOURCE_REVISION=${{ steps.tags.outputs.revision }}');
    const smoke = steps.find((step: { name?: string }) => step.name === 'Smoke test');
    expect(smoke.run).toContain('deploy-confirm.mjs');
    expect(smoke.run).toContain('DEPLOYMENT_TIMEOUT_MS=90000');
  });
  it('confirms only after an actual request; no deployment secrets reach the probe', () => {
    const request = steps.find((step: { id?: string }) => step.id === 'deploy');
    expect(request.run).toContain('requested=false');
    expect(request.run).toContain('requested=true');
    const confirm = steps.find(
      (step: { name?: string }) => step.name === 'Confirm the running web and worker revision',
    );
    expect(confirm.if).toBe("steps.deploy.outputs.requested == 'true'");
    expect(Object.keys(confirm.env)).toEqual(['DEPLOYMENT_URL', 'DEPLOYMENT_REVISION']);
    expect(confirm.env.DEPLOYMENT_REVISION).toBe('${{ steps.tags.outputs.revision }}');
    expect(confirm.run).toBe('node .github/scripts/deploy-confirm.mjs');
    expect(workflow.concurrency['cancel-in-progress']).toBe(false);
  });
  it('copies root-owned generated metadata into both runtime images', () => {
    const docker = readFileSync('Dockerfile', 'utf8');
    expect(docker.match(/COPY --from=build \/app\/deployment-revision.json/g)).toHaveLength(2);
    expect(docker.match(/LABEL org.opencontainers.image.revision=/g)).toHaveLength(2);
    const ignored = readFileSync('.dockerignore', 'utf8').split('\n');
    for (const path of [
      'deployment-revision.json',
      'ops/terraform',
      'ops/ansible',
      '.codex',
      '.agents',
      '.aws',
      'docs-site/.next',
    ])
      expect(ignored).toContain(path);
  });
});
