import { appendFile } from 'node:fs/promises';
import { execFileSync, spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// ADR-071: which parts of CI's verify job a change needs. Typecheck, lint and
// unit tests always run (they check workflows, ADRs, Ansible and Docker files
// too). The app part (app build, Postgres/Redis, integration tests) and the
// docs part (docs build, browser tests, the publishable export) are skipped
// only when EVERY changed path is explicitly known not to affect them. Any
// unknown path, or any doubt about the diff, runs everything.

const shaPattern = /^[a-f0-9]{40}$/;

/**
 * Paths that cannot change whether the app build or the integration tests
 * pass. (Tailwind scans the whole repository, so one may still add a CSS
 * class to the build output; main's full run builds it before any deploy.)
 */
const appSafePrefixes = [
  '.agents/',
  '.claude/',
  '.codex/',
  'docs/',
  'notes/',
  'ops/ansible/',
  'ops/terraform/',
];
/** Paths that change neither the docs build nor its source excerpts and links. */
const docsSafePrefixes = [
  '.agents/',
  '.claude/',
  '.codex/',
  'notes/',
  'ops/ansible/',
  'ops/terraform/',
];
/** CI's own wiring: a change here is checked by a full run. */
const ciPaths = ['.github/workflows/ci.yml', '.github/scripts/ci-select.mjs'];
/** The docs publisher's wiring and the files its tests read. */
const docsGithubPaths = ['.github/workflows/docs-deploy.yml'];
/** Root files only the deploy (or nothing in CI) reads. */
const rootSafeFiles = ['.trivyignore.yaml'];

function validPath(path) {
  return typeof path === 'string' && path !== '' && !path.includes('\0') && !path.includes('�');
}

function rootSafe(path) {
  return !path.includes('/') && (path.endsWith('.md') || rootSafeFiles.includes(path));
}

/** True when the path cannot change the app build or the integration tests. */
export function isAppSafePath(path) {
  if (!validPath(path)) return false;
  if (rootSafe(path)) return true;
  if (ciPaths.includes(path)) return false;
  if (path.startsWith('.github/')) return true;
  if (path === 'docs-site/package.json') return false;
  if (path.startsWith('docs-site/')) return true;
  return appSafePrefixes.some((prefix) => path.startsWith(prefix));
}

/** True when the path cannot change the docs build, its excerpts or its links. */
export function isDocsSafePath(path) {
  if (!validPath(path)) return false;
  if (rootSafe(path)) return true;
  if (ciPaths.includes(path) || docsGithubPaths.includes(path)) return false;
  if (path.startsWith('.github/scripts/docs-')) return false;
  if (path.startsWith('.github/')) return true;
  // The docs link to ADRs (SourceLink) but no other repository docs.
  if (path.startsWith('docs/')) return !path.startsWith('docs/decisions/');
  return docsSafePrefixes.some((prefix) => path.startsWith(prefix));
}

const full = (reason) => ({ app: true, docs: true, reason });

/** `paths` is the full changed-path list, or null when it could not be computed. */
export function decideChecks(paths) {
  if (!Array.isArray(paths)) return full('diff_unavailable');
  // An empty diff is suspicious (a re-run with lost history, a bad base): run all.
  if (paths.length === 0) return full('empty_diff');
  const app = !paths.every(isAppSafePath);
  const docs = !paths.every(isDocsSafePath);
  const reason =
    app && docs ? 'full' : app ? 'docs_unaffected' : docs ? 'app_unaffected' : 'checks_only';
  return { app, docs, reason };
}

/** Git in `cwd` (the checkout); a parameter so tests can use a scratch repository. */
export function repositoryGit(cwd = process.cwd()) {
  const ok = (args) => spawnSync('git', args, { cwd, stdio: 'ignore' }).status === 0;
  return {
    hasCommit: (revision) => ok(['cat-file', '-e', `${revision}^{commit}`]),
    fetch: (revision) => ok(['fetch', '--no-tags', '--depth=1', 'origin', revision]),
    changedPaths: (older, newer) =>
      execFileSync('git', ['diff', '--name-only', '--no-renames', '-z', older, newer, '--'], {
        cwd,
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'ignore'],
      })
        .split('\0')
        .filter(Boolean),
  };
}

/**
 * The changed paths between a PR's base commit and its merge commit. Renames
 * are a deletion plus an addition, so moving a file out of an unsafe directory
 * still names that directory.
 */
export function selectChecks({ event, baseRef, base, head, git = repositoryGit() }) {
  // Pushes to main always run everything: deploy (ADR-067) and the docs
  // publisher treat a green main run as proof that the whole tree passed.
  // A fast push run after an untested or failed merge would break that.
  if (event !== 'pull_request') return full('not_a_pull_request');
  // Only a PR into main. Changing a PR's base starts no new run, so a fast
  // result computed against another branch could otherwise outlive a retarget.
  if (baseRef !== 'main') return full('base_not_main');
  if (!shaPattern.test(base ?? '') || !shaPattern.test(head ?? '') || /^0+$/.test(base))
    return decideChecks(null);
  try {
    if (!git.hasCommit(base) && !(git.fetch(base) && git.hasCommit(base)))
      return decideChecks(null);
    return decideChecks(git.changedPaths(base, head));
  } catch {
    return decideChecks(null);
  }
}

async function writeResult(result) {
  if (!process.env.GITHUB_OUTPUT) throw new Error('GITHUB_OUTPUT is required');
  await appendFile(
    process.env.GITHUB_OUTPUT,
    `app=${String(result.app)}\ndocs=${String(result.docs)}\nreason=${result.reason}\n`,
  );
  const line = (on, what) => `- ${what}: **${on ? 'run' : 'skipped (no affecting change)'}**`;
  if (process.env.GITHUB_STEP_SUMMARY)
    await appendFile(
      process.env.GITHUB_STEP_SUMMARY,
      `### CI selection (ADR-071)\n\n- Typecheck, lint, unit tests: **run**\n${line(result.app, 'App build and integration tests')}\n${line(result.docs, 'Docs build, browser tests and export')}\n- Reason: \`${result.reason}\`\n`,
    );
  console.log(`CI selection: app=${result.app} docs=${result.docs} (${result.reason})`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  let result;
  try {
    result = selectChecks({
      event: process.env.CI_EVENT,
      baseRef: process.env.CI_BASE_REF,
      base: process.env.CI_BASE,
      head: process.env.CI_HEAD,
    });
  } catch {
    result = full('selection_failed');
  }
  await writeResult(result);
}
