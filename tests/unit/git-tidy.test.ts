/**
 * scripts/git-tidy.sh runs at the start of every Claude Code session and
 * deletes local branches. These tests build a throwaway "GitHub" (a bare
 * repository) and a clone in a temp folder, so the script is proven on
 * every case before it ever touches the real repository:
 *
 * - merged branches GitHub deleted are removed, whether merged with a merge
 *   commit (the old way) or squashed (ADR-090), "Update branch" included;
 *   everything else is kept;
 * - a branch GitHub deleted but main does not contain is never removed, nor
 *   one given more commits after it was squashed, even whitespace only
 *   (patch-id ignores whitespace), nor one whose commits cancel out;
 * - a finished branch you are on is left for main only when nothing is
 *   uncommitted;
 * - main fast-forwards, and a second run has nothing to do;
 * - offline, nothing changes.
 */
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

const script = resolve('scripts/git-tidy.sh');
const env = {
  ...process.env,
  GIT_AUTHOR_NAME: 'test',
  GIT_AUTHOR_EMAIL: 'test@example.com',
  GIT_COMMITTER_NAME: 'test',
  GIT_COMMITTER_EMAIL: 'test@example.com',
  GIT_CONFIG_GLOBAL: '/dev/null',
  GIT_CONFIG_NOSYSTEM: '1',
};

const merged = ['merged-a', 'merged-b', 'current-merged'];
const squashed = ['squashed', 'squashed-updated', 'squash-then-more', 'squash-then-indent'];

let dir: string;
let hub: string;
let work: string;

const git = (cwd: string, ...args: string[]) =>
  execFileSync('git', args, { cwd, env, encoding: 'utf8', stdio: 'pipe' }).trim();
const tidy = () => execFileSync('bash', [script], { cwd: work, env, encoding: 'utf8' });
const commitFile = (cwd: string, name: string) => {
  writeFileSync(join(cwd, name), `${name}\n`);
  git(cwd, 'add', name);
  git(cwd, 'commit', '-q', '-m', name);
};
const branches = () => git(work, 'branch', '--format=%(refname:short)').split('\n').sort();

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'git-tidy-'));
  hub = join(dir, 'hub');
  work = join(dir, 'work');
  git(dir, 'init', '-q', '--bare', '-b', 'main', hub);
  git(dir, 'init', '-q', '-b', 'main', work);
  git(work, 'commit', '-q', '--allow-empty', '-m', 'init');
  for (const b of [...merged, 'unmerged', 'still-open']) {
    git(work, 'switch', '-q', '-c', b, 'main');
    git(work, 'commit', '-q', '--allow-empty', '-m', b);
  }
  // A squash is matched by its change, so these branches change files.
  for (const b of squashed) {
    git(work, 'switch', '-q', '-c', b, 'main');
    commitFile(work, `${b}.txt`);
  }
  git(work, 'switch', '-q', 'main');
  // "GitHub" receives every branch, and the clone tracks them.
  git(hub, 'fetch', '-q', work, 'refs/heads/*:refs/heads/*');
  git(work, 'remote', 'add', 'origin', hub);
  git(work, 'fetch', '-q', 'origin');
  for (const b of ['main', ...merged, 'unmerged', 'still-open', ...squashed]) {
    git(work, 'branch', '-q', '-u', `origin/${b}`, b);
  }
  // "GitHub" merges three with merge commits, as before ADR-090.
  const gh = join(dir, 'gh');
  git(dir, 'clone', '-q', hub, gh);
  for (const b of merged) {
    git(gh, 'merge', '-q', '--no-ff', `origin/${b}`, '-m', `Merge ${b}`);
  }
  // Main moves on, and "Update branch" merges it into `squashed-updated`,
  // which the clone pulls.
  commitFile(gh, 'unrelated.txt');
  git(gh, 'switch', '-q', '-c', 'squashed-updated', 'origin/squashed-updated');
  git(gh, 'merge', '-q', '--no-edit', 'main');
  git(gh, 'push', '-q', 'origin', 'squashed-updated');
  git(gh, 'switch', '-q', 'main');
  git(work, 'fetch', '-q', 'origin', 'squashed-updated:squashed-updated');
  // Then it squashes the rest (ADR-090).
  for (const b of squashed) {
    git(gh, 'merge', '-q', '--squash', `origin/${b}`);
    git(gh, 'commit', '-q', '-m', `${b} (#1)`);
  }
  git(hub, 'fetch', '-q', gh, 'main:main');
  // Work added after a squash is not on main.
  git(work, 'switch', '-q', 'squash-then-more');
  commitFile(work, 'more.txt');
  // A whitespace-only change after the squash: same patch-id, different
  // file (in YAML, a different meaning).
  git(work, 'switch', '-q', 'squash-then-indent');
  writeFileSync(join(work, 'squash-then-indent.txt'), '  squash-then-indent.txt\n');
  git(work, 'commit', '-q', '-am', 'indent');
  // Commits that cancel out: nothing to match, nothing on main.
  git(work, 'switch', '-q', '-c', 'net-empty', 'main');
  commitFile(work, 'net-empty.txt');
  git(work, 'revert', '--no-edit', 'HEAD');
  git(hub, 'fetch', '-q', work, 'net-empty:net-empty');
  git(work, 'fetch', '-q', 'origin');
  git(work, 'branch', '-q', '-u', 'origin/net-empty', 'net-empty');
  git(work, 'switch', '-q', 'main');
  // GitHub deletes every finished branch, and `unmerged` and `net-empty`.
  for (const b of [...merged, ...squashed, 'unmerged', 'net-empty']) {
    git(hub, 'branch', '-q', '-D', b);
  }
});

afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe('git-tidy', () => {
  it('removes only merged branches GitHub deleted, and steps off a finished one', () => {
    git(work, 'switch', '-q', 'current-merged');
    const out = tidy();

    expect(branches()).toEqual([
      'main',
      'net-empty',
      'squash-then-indent',
      'squash-then-more',
      'still-open',
      'unmerged',
    ]);
    expect(git(work, 'branch', '--show-current')).toBe('main');
    expect(git(work, 'rev-parse', 'main')).toBe(git(hub, 'rev-parse', 'main'));
    expect(out).toContain('removed 5 merged branch(es)');
    expect(out).toMatch(/unmerged was deleted on GitHub but has commits main doesn't, kept/);
    for (const b of ['squash-then-more', 'squash-then-indent', 'net-empty']) {
      expect(out).toContain(`${b} was deleted on GitHub but has commits main doesn't, kept`);
    }
  });

  it('steps off a branch GitHub squashed', () => {
    git(work, 'switch', '-q', 'squashed-updated');
    const out = tidy();

    expect(git(work, 'branch', '--show-current')).toBe('main');
    expect(branches()).not.toContain('squashed-updated');
    expect(out).toContain('left merged squashed-updated for main');
  });

  it('has nothing to do the second time', () => {
    tidy();
    const second = tidy();
    expect(second).not.toContain('removed');
    expect(second).not.toContain('main +');
  });

  it('never leaves a finished branch that has uncommitted work', () => {
    git(work, 'switch', '-q', 'current-merged');
    writeFileSync(join(work, 'draft.txt'), 'not committed');

    const out = tidy();

    expect(git(work, 'branch', '--show-current')).toBe('current-merged');
    expect(branches()).toContain('current-merged');
    expect(out).toMatch(/current-merged is merged but has 1 uncommitted file/);
  });

  it('changes nothing when GitHub cannot be reached', () => {
    git(work, 'remote', 'set-url', 'origin', join(dir, 'missing'));
    const before = branches();

    const out = tidy();

    expect(branches()).toEqual(before);
    expect(out).toContain('could not reach GitHub');
  });

  it('prints valid hook JSON for Claude Code', () => {
    const out = execFileSync('bash', [script, '--hook'], { cwd: work, env, encoding: 'utf8' });
    const json = JSON.parse(out) as {
      systemMessage: string;
      hookSpecificOutput: { hookEventName: string; additionalContext: string };
    };
    expect(json.hookSpecificOutput.hookEventName).toBe('SessionStart');
    expect(json.systemMessage).toMatch(/^git: /);
  });
});
