import { execFileSync } from 'node:child_process';
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  renameSync,
  rmSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterAll, describe, expect, it, vi } from 'vitest';
import { parse } from 'yaml';
import {
  decideChecks,
  isAppSafePath,
  isDocsSafePath,
  repositoryGit,
  selectChecks,
} from '../../.github/scripts/ci-select.mjs';

const sha = (c: string) => c.repeat(40);

// ADR-071: CI's fast path. Unsafe means "this part must run".
describe('CI path policy', () => {
  it('runs everything for application code, tests, packages and anything unknown', () => {
    for (const path of [
      'src/worker.ts',
      'src/app/(public)/page.tsx',
      'tests/unit/money.test.ts',
      'tests/integration/inventory.concurrency.test.ts',
      'drizzle/0028_x.sql',
      'scripts/migrate.ts',
      'public/robots.txt',
      'package.json',
      'pnpm-lock.yaml',
      'pnpm-workspace.yaml',
      '.nvmrc',
      'next.config.ts',
      'Dockerfile',
      'docker-compose.yml',
      'LICENSE',
      'relay/src/index.ts',
      'ops/other/x.sh',
      'docs-site/package.json',
      '.github/workflows/ci.yml',
      '.github/scripts/ci-select.mjs',
      '',
      'src/\0x',
      'src/�',
    ]) {
      expect(isAppSafePath(path), path).toBe(false);
      expect(isDocsSafePath(path), path).toBe(false);
    }
  });

  it('skips both parts for infrastructure, agent files, root notes and deploy-only wiring', () => {
    for (const path of [
      'ops/terraform/aws/main.tf',
      'ops/ansible/roles/base/tasks/main.yml',
      '.claude/settings.json',
      '.agents/x.md',
      '.codex/x.md',
      'notes/PHASES.md',
      'README.md',
      'CHANGELOG.md',
      '.trivyignore.yaml',
      '.github/workflows/deploy.yml',
      '.github/workflows/release.yml',
      '.github/scripts/deploy-select.mjs',
      '.github/dependabot.yml',
      '.github/pull_request_template.md',
      'docs/RUNBOOK.md',
      'docs/infra/TERRAFORM.md',
    ]) {
      expect(isAppSafePath(path), path).toBe(true);
      expect(isDocsSafePath(path), path).toBe(true);
    }
  });

  it('builds the docs, but not the app, for docs sources, ADRs and docs wiring', () => {
    for (const path of [
      'docs-site/content/docs/index.mdx',
      'docs-site/components/ticket-race.tsx',
      'docs/decisions/070-shared-auth-rate-limit.md',
      'docs/decisions/README.md',
      '.github/workflows/docs-deploy.yml',
      '.github/scripts/docs-release.mjs',
      '.github/scripts/docs-publication.test.mjs',
    ]) {
      expect(isAppSafePath(path), path).toBe(true);
      expect(isDocsSafePath(path), path).toBe(false);
    }
  });

  it('decides per change: one unsafe path is enough; doubt runs everything', () => {
    expect(decideChecks(['ops/terraform/aws/main.tf', 'README.md'])).toEqual({
      app: false,
      docs: false,
      reason: 'checks_only',
    });
    expect(decideChecks(['docs/decisions/README.md', 'docs/RUNBOOK.md'])).toEqual({
      app: false,
      docs: true,
      reason: 'app_unaffected',
    });
    expect(decideChecks(['docs/RUNBOOK.md', 'src/worker.ts'])).toEqual({
      app: true,
      docs: true,
      reason: 'full',
    });
    expect(decideChecks([])).toEqual({ app: true, docs: true, reason: 'empty_diff' });
    expect(decideChecks(null)).toEqual({ app: true, docs: true, reason: 'diff_unavailable' });
  });
});

describe('CI selection from git', () => {
  const git = (paths: string[] | Error, present = true, fetched = true) => ({
    hasCommit: vi.fn(() => present),
    fetch: vi.fn(() => fetched),
    changedPaths: vi.fn(() => {
      if (paths instanceof Error) throw paths;
      return paths;
    }),
  });

  it('compares the base with the checked-out commit, fetching the base if needed', () => {
    const repo = git(['ops/terraform/aws/main.tf'], false, true);
    repo.hasCommit.mockReturnValueOnce(false).mockReturnValueOnce(true);
    expect(
      selectChecks({
        event: 'pull_request',
        baseRef: 'main',
        base: sha('a'),
        head: sha('b'),
        git: repo,
      }),
    ).toMatchObject({
      app: false,
      docs: false,
    });
    expect(repo.fetch).toHaveBeenCalledWith(sha('a'));
    expect(repo.changedPaths).toHaveBeenCalledWith(sha('a'), sha('b'));
  });

  it('runs everything when the base is missing, zero, malformed or unreachable', () => {
    for (const base of [undefined, '', sha('0'), 'main', sha('a').slice(1)]) {
      const repo = git(['README.md']);
      expect(
        selectChecks({ event: 'pull_request', baseRef: 'main', base, head: sha('b'), git: repo }),
        String(base),
      ).toMatchObject({
        app: true,
        docs: true,
      });
      expect(repo.changedPaths).not.toHaveBeenCalled();
    }
    expect(
      selectChecks({
        event: 'pull_request',
        baseRef: 'main',
        base: sha('a'),
        head: sha('b'),
        git: git(['README.md'], false, false),
      }),
    ).toMatchObject({ app: true, docs: true, reason: 'diff_unavailable' });
    expect(
      selectChecks({
        event: 'pull_request',
        baseRef: 'main',
        base: sha('a'),
        head: sha('b'),
        git: git(new Error('bad object')),
      }),
    ).toMatchObject({ app: true, docs: true, reason: 'diff_unavailable' });
  });
});

describe('PRs into other branches', () => {
  it('run everything, so retargeting one to main never keeps a fast result', () => {
    for (const baseRef of ['feature-a', '', undefined]) {
      const repo = { hasCommit: vi.fn(), fetch: vi.fn(), changedPaths: vi.fn(() => ['README.md']) };
      expect(
        selectChecks({ event: 'pull_request', baseRef, base: sha('a'), head: sha('b'), git: repo }),
      ).toEqual({ app: true, docs: true, reason: 'base_not_main' });
      expect(repo.changedPaths).not.toHaveBeenCalled();
    }
  });
});

describe('pushes to main', () => {
  it('always run everything: a green main run deploys and publishes', () => {
    for (const event of ['push', 'workflow_dispatch', undefined]) {
      const repo = { hasCommit: vi.fn(), fetch: vi.fn(), changedPaths: vi.fn(() => ['README.md']) };
      expect(
        selectChecks({ event, baseRef: 'main', base: sha('a'), head: sha('b'), git: repo }),
      ).toEqual({
        app: true,
        docs: true,
        reason: 'not_a_pull_request',
      });
      expect(repo.changedPaths).not.toHaveBeenCalled();
    }
  });
});

describe('the real git diff', () => {
  const root = mkdtempSync(join(tmpdir(), 'ci-select-'));
  afterAll(() => rmSync(root, { recursive: true, force: true }));
  // Isolated from the developer's git config (signing, hooks, templates).
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    GIT_CONFIG_GLOBAL: '/dev/null',
    GIT_CONFIG_NOSYSTEM: '1',
  };
  for (const name of ['GIT_DIR', 'GIT_INDEX_FILE', 'GIT_WORK_TREE']) delete env[name];
  const run = (...args: string[]) =>
    execFileSync('git', args, { cwd: root, env, encoding: 'utf8' }).trim();
  const write = (path: string, text: string) => {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), text);
  };

  it('names both sides of a rename, every deletion and odd names, so moving src/ code runs all', () => {
    run('init', '-q', '-b', 'main');
    run('config', 'user.email', 'ci@example.test');
    run('config', 'user.name', 'CI');
    write('src/lib/rules.ts', 'export const rules = 1;\n'.repeat(20));
    write('src/old.ts', 'export {};\n');
    run('add', '-A');
    run('commit', '-q', '-m', 'base');
    const base = run('rev-parse', 'HEAD');
    mkdirSync(join(root, 'docs'), { recursive: true });
    renameSync(join(root, 'src/lib/rules.ts'), join(root, 'docs/rules.ts'));
    unlinkSync(join(root, 'src/old.ts'));
    // Non-ASCII: git quotes it unless the paths are NUL-separated (-z).
    write('docs/café notes.md', 'note\n');
    run('add', '-A');
    run('commit', '-q', '-m', 'move');
    const head = run('rev-parse', 'HEAD');
    const git = repositoryGit(root);
    expect(git.changedPaths(base, head).sort()).toEqual([
      'docs/café notes.md',
      'docs/rules.ts',
      'src/lib/rules.ts',
      'src/old.ts',
    ]);
    expect(selectChecks({ event: 'pull_request', baseRef: 'main', base, head, git })).toMatchObject(
      {
        app: true,
        docs: true,
        reason: 'full',
      },
    );
  });
});

describe('the verify job (ci.yml)', () => {
  const ci = parse(readFileSync('.github/workflows/ci.yml', 'utf8')) as {
    jobs: Record<string, { steps: { name?: string; run?: string; if?: string; uses?: string }[] }>;
  };
  const steps = ci.jobs.verify!.steps;
  const step = (run: string) => steps.find((s) => s.run === run);

  it('runs exactly the parts of `pnpm verify`, each present, under its own condition', () => {
    const { scripts } = JSON.parse(readFileSync('package.json', 'utf8')) as {
      scripts: Record<string, string>;
    };
    expect(scripts.verify!.split(' && ')).toEqual([
      'pnpm typecheck',
      'pnpm lint',
      'pnpm test',
      'pnpm build',
      'pnpm docs:verify',
    ]);
    for (const always of ['pnpm typecheck', 'pnpm lint', 'pnpm test']) {
      expect(step(always), always).toBeDefined();
      expect(step(always)!.if, always).toBeUndefined();
    }
  });

  it('gates every app and docs step on its own part; only the marker runs on "false"', () => {
    const app = "steps.select.outputs.app != 'false'";
    const docs = "steps.select.outputs.docs != 'false'";
    const expected: [(s: (typeof steps)[number]) => boolean, string, number][] = [
      [(s) => s.name === 'Start Postgres and Redis', app, 1],
      [(s) => s.run === 'pnpm build', app, 1],
      [(s) => s.name === 'Wait for Postgres and Redis', app, 1],
      [(s) => s.run === 'pnpm db:migrate', app, 1],
      [(s) => s.run === 'pnpm test:integration:db', app, 1],
      [(s) => s.run === 'pnpm docs:verify', docs, 1],
      [(s) => s.run === 'pnpm exec playwright install --with-deps chromium', docs, 1],
      [(s) => s.run === 'pnpm docs:test', docs, 2],
      [(s) => s.name === 'Package docs export', docs, 1],
      [
        (s) =>
          s.uses === 'actions/upload-artifact@v7' &&
          JSON.stringify(s).includes('docs-site-${{ github.run_id }}'),
        docs,
        1,
      ],
      [(s) => s.name === 'Mark docs unaffected', "steps.select.outputs.docs == 'false'", 1],
      [
        (s) =>
          s.uses === 'actions/upload-artifact@v7' &&
          JSON.stringify(s).includes('docs-unchanged-${{ github.run_id }}'),
        "steps.select.outputs.docs == 'false'",
        1,
      ],
    ];
    let gated = 0;
    for (const [match, condition, count] of expected) {
      const found = steps.filter(match);
      expect(found, condition).toHaveLength(count);
      for (const s of found) expect(s.if).toBe(condition);
      gated += count;
    }
    // Nothing else is conditional.
    expect(steps.filter((s) => s.if)).toHaveLength(gated);
  });

  it('selects first, from the PR base only (a push runs everything)', () => {
    const select = steps.findIndex((s) => s.name === 'Select checks');
    expect(select).toBe(1);
    const env = JSON.stringify(steps[select]);
    expect(env).toContain('CI_EVENT":"${{ github.event_name }}');
    expect(env).toContain('CI_BASE":"${{ github.event.pull_request.base.sha }}');
    expect(env).not.toContain('github.event.before');
    expect(ci.jobs.verify).not.toHaveProperty('services');
  });
});
