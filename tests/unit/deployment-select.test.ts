import { describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { parse } from 'yaml';
import {
  decideDeployment,
  isNonRuntimePath,
  selectDeployment,
} from '../../.github/scripts/deploy-select.mjs';

const running = 'a'.repeat(40);
const candidate = 'b'.repeat(40);

const git = (changes: Partial<Record<string, unknown>> = {}) => ({
  head: () => candidate,
  currentMain: () => candidate,
  hasCommit: () => true,
  isAncestor: (older: string, newer: string) => older === running && newer === candidate,
  changedPaths: () => ['docs/DEPLOY.md'],
  ...changes,
});

describe('application deployment path policy', () => {
  it('allows only explicit non-runtime paths', () => {
    for (const path of [
      'README.md',
      'docs/DEPLOY.md',
      'docs-site/app/page.tsx',
      '.github/workflows/deploy.yml',
      '.agents/skills/source-command-slice/SKILL.md',
      '.claude/commands/slice.md',
      '.codex/config.toml',
      'notes/PROGRESS.md',
      'ops/ansible/site.yml',
      'ops/terraform/aws/main.tf',
      'tests/unit/deployment-select.test.ts',
    ])
      expect(isNonRuntimePath(path), path).toBe(true);

    for (const path of [
      'docs-site/package.json',
      'Dockerfile',
      '.dockerignore',
      'package.json',
      'pnpm-lock.yaml',
      'next.config.ts',
      'drizzle/0026_runtime.sql',
      'src/app/page.tsx',
      'scripts/migrate.ts',
      'ops/db/app-role.sql',
      'relay/src/index.ts',
      'unknown/new-runtime-input',
      'docs/invalid\ufffdname.md',
    ])
      expect(isNonRuntimePath(path), path).toBe(false);
  });

  it('skips only when every change since the running revision is non-runtime', () => {
    expect(
      decideDeployment({
        eventName: 'workflow_run',
        candidate,
        currentMain: candidate,
        running,
        relation: 'running-ancestor',
        paths: ['docs/DEPLOY.md', 'docs-site/app/page.tsx', 'tests/unit/example.test.ts'],
      }),
    ).toEqual({ deploy: false, reason: 'non_runtime_only', running });

    for (const paths of [
      ['docs/DEPLOY.md', 'src/worker.ts'],
      ['docs-site/package.json'],
      ['unknown/new-file'],
    ])
      expect(
        decideDeployment({
          eventName: 'workflow_run',
          candidate,
          currentMain: candidate,
          running,
          relation: 'running-ancestor',
          paths,
        }),
      ).toEqual({ deploy: true, reason: 'runtime_changes', running });
  });

  it('keeps recovery runs unconditional and avoids redundant or stale runs', () => {
    expect(
      decideDeployment({
        eventName: 'workflow_dispatch',
        candidate,
        currentMain: candidate,
        running,
        relation: 'candidate-behind',
        paths: ['src/worker.ts'],
      }),
    ).toEqual({ deploy: true, reason: 'manual', running: null });
    expect(
      decideDeployment({
        eventName: 'workflow_run',
        candidate,
        currentMain: candidate,
        running: candidate,
        relation: null,
        paths: [],
      }),
    ).toEqual({ deploy: false, reason: 'already_running', running: candidate });
    expect(
      decideDeployment({
        eventName: 'workflow_run',
        candidate: running,
        currentMain: candidate,
        running: null,
        relation: null,
        paths: [],
      }),
    ).toEqual({ deploy: false, reason: 'stale_candidate', running: null });
  });

  it('deploys current main when live evidence is unavailable', () => {
    expect(
      decideDeployment({
        eventName: 'workflow_run',
        candidate,
        currentMain: candidate,
        running: null,
        relation: null,
        paths: [],
      }),
    ).toEqual({ deploy: true, reason: 'evidence_unavailable', running: null });
  });

  it('fails safely instead of rolling back or trusting unrelated history', () => {
    for (const relation of ['candidate-behind', 'diverged'])
      expect(() =>
        decideDeployment({
          eventName: 'workflow_run',
          candidate,
          currentMain: candidate,
          running,
          relation,
          paths: [],
        }),
      ).toThrow(relation === 'candidate-behind' ? 'behind' : 'not in the candidate history');
  });
});

describe('application deployment selection', () => {
  it('compares the complete confirmed-baseline-to-candidate diff', async () => {
    const changedPaths = vi.fn(() => [
      'docs/DEPLOY.md',
      'docs-site/app/page.tsx',
      'tests/unit/deployment-select.test.ts',
    ]);
    await expect(
      selectDeployment({
        eventName: 'workflow_run',
        candidate,
        deploymentUrl: 'https://example.com/api/deployment',
        readRevision: async () => running,
        git: git({ changedPaths }),
      }),
    ).resolves.toEqual({ deploy: false, reason: 'non_runtime_only', running });
    expect(changedPaths).toHaveBeenCalledWith(running, candidate);
  });

  it('does not consult production for manual or stale workflow runs', async () => {
    const readRevision = vi.fn(async () => running);
    await expect(
      selectDeployment({
        eventName: 'workflow_dispatch',
        candidate,
        deploymentUrl: 'https://example.com/api/deployment',
        readRevision,
        git: git(),
      }),
    ).resolves.toMatchObject({ deploy: true, reason: 'manual' });
    await expect(
      selectDeployment({
        eventName: 'workflow_run',
        candidate,
        deploymentUrl: 'https://example.com/api/deployment',
        readRevision,
        git: git({ currentMain: () => running }),
      }),
    ).resolves.toMatchObject({ deploy: false, reason: 'stale_candidate' });
    expect(readRevision).not.toHaveBeenCalled();
  });

  it('fails when the confirmed revision is absent, ahead or unrelated', async () => {
    await expect(
      selectDeployment({
        eventName: 'workflow_run',
        candidate,
        deploymentUrl: 'https://example.com/api/deployment',
        readRevision: async () => running,
        git: git({ hasCommit: () => false }),
      }),
    ).rejects.toThrow('absent');

    for (const isAncestor of [
      (older: string, newer: string) => older === candidate && newer === running,
      () => false,
    ])
      await expect(
        selectDeployment({
          eventName: 'workflow_run',
          candidate,
          deploymentUrl: 'https://example.com/api/deployment',
          readRevision: async () => running,
          git: git({ isAncestor }),
        }),
      ).rejects.toThrow();
  });

  it('treats an unhealthy or unavailable endpoint as deploy, never skip', async () => {
    await expect(
      selectDeployment({
        eventName: 'workflow_run',
        candidate,
        deploymentUrl: 'https://example.com/api/deployment',
        readRevision: async () => {
          throw new Error('private response body');
        },
        git: git(),
      }),
    ).resolves.toEqual({ deploy: true, reason: 'evidence_unavailable', running: null });
  });
});

describe('production deployment selection workflow contract', () => {
  const workflow = parse(readFileSync('.github/workflows/deploy.yml', 'utf8'));

  it('selects without secrets before granting the image job package access', () => {
    const selection = workflow.jobs.selection;
    expect(selection.permissions).toEqual({ contents: 'read' });
    const step = selection.steps.find((item: { id?: string }) => item.id === 'selection');
    expect(Object.keys(step.env).sort()).toEqual([
      'DEPLOYMENT_CANDIDATE',
      'DEPLOYMENT_EVENT',
      'DEPLOYMENT_URL',
    ]);
    expect(workflow.jobs.images.needs).toBe('selection');
    expect(workflow.jobs.images.if).toContain("needs.selection.outputs.deploy == 'true'");
    expect(workflow.jobs.images.permissions).toEqual({ contents: 'read', packages: 'write' });
  });

  it('fetches complete history and keeps deployment serialization', () => {
    const checkout = workflow.jobs.selection.steps.find(
      (item: { uses?: string }) => item.uses === 'actions/checkout@v7',
    );
    expect(checkout.with['fetch-depth']).toBe(0);
    expect(workflow.concurrency['cancel-in-progress']).toBe(false);
    expect(readFileSync('.github/scripts/deploy-select.mjs', 'utf8')).toContain("'--no-renames'");
  });
});
