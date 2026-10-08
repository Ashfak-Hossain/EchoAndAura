import { appendFile } from 'node:fs/promises';
import { execFileSync, spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readHealthyDeploymentRevision } from './deploy-confirm.mjs';

const shaPattern = /^[a-f0-9]{40}$/;

const nonRuntimePrefixes = [
  '.agents/',
  '.claude/',
  '.codex/',
  '.github/',
  'docs/',
  'notes/',
  'ops/ansible/',
  'ops/terraform/',
  'tests/',
];

export function isNonRuntimePath(path) {
  if (typeof path !== 'string' || path === '' || path.includes('\0') || path.includes('\ufffd'))
    return false;
  if (!path.includes('/')) return path.endsWith('.md');
  if (path === 'docs-site/package.json') return false;
  if (path.startsWith('docs-site/')) return true;
  return nonRuntimePrefixes.some((prefix) => path.startsWith(prefix));
}

export function decideDeployment({ eventName, candidate, currentMain, running, relation, paths }) {
  if (!shaPattern.test(candidate) || !shaPattern.test(currentMain))
    throw new Error('Invalid deployment selection configuration');

  if (eventName === 'workflow_dispatch') return { deploy: true, reason: 'manual', running: null };
  if (eventName !== 'workflow_run') throw new Error('Invalid deployment selection configuration');

  // An old completed CI run must not publish after main has moved on. The
  // current main run will make its own decision when its CI finishes.
  if (candidate !== currentMain) return { deploy: false, reason: 'stale_candidate', running: null };

  // No trustworthy baseline means no trustworthy skip. Preserve the previous
  // behavior and build/deploy the current main revision.
  if (running === null) return { deploy: true, reason: 'evidence_unavailable', running: null };
  if (!shaPattern.test(running)) throw new Error('Invalid deployment selection evidence');
  if (running === candidate) return { deploy: false, reason: 'already_running', running };

  if (relation === 'candidate-behind')
    throw new Error('Refusing to deploy a revision behind the confirmed production revision');
  if (relation !== 'running-ancestor')
    throw new Error('Confirmed production revision is not in the candidate history');
  if (!Array.isArray(paths)) throw new Error('Invalid deployment selection evidence');

  const deploy = !paths.every(isNonRuntimePath);
  return {
    deploy,
    reason: deploy ? 'runtime_changes' : 'non_runtime_only',
    running,
  };
}

function gitOutput(args) {
  return execFileSync('git', args, {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'ignore'],
  }).trim();
}

function hasCommit(revision) {
  return (
    spawnSync('git', ['cat-file', '-e', `${revision}^{commit}`], { stdio: 'ignore' }).status === 0
  );
}

function isAncestor(older, newer) {
  return (
    spawnSync('git', ['merge-base', '--is-ancestor', older, newer], {
      stdio: 'ignore',
    }).status === 0
  );
}

function changedPaths(older, newer) {
  const value = execFileSync(
    'git',
    ['diff', '--name-only', '--no-renames', '-z', older, newer, '--'],
    { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] },
  );
  return value.split('\0').filter(Boolean);
}

const repositoryGit = {
  head: () => gitOutput(['rev-parse', 'HEAD']),
  currentMain: () => gitOutput(['rev-parse', 'refs/remotes/origin/main']),
  hasCommit,
  isAncestor,
  changedPaths,
};

export async function selectDeployment({
  eventName,
  candidate,
  deploymentUrl,
  readRevision = readHealthyDeploymentRevision,
  git = repositoryGit,
}) {
  if (!shaPattern.test(candidate)) throw new Error('Invalid deployment selection configuration');
  const head = git.head();
  if (head !== candidate)
    throw new Error('Checked-out revision does not match the deployment candidate');

  if (eventName === 'workflow_dispatch')
    return decideDeployment({
      eventName,
      candidate,
      currentMain: candidate,
      running: null,
      relation: null,
      paths: [],
    });

  const currentMain = git.currentMain();
  if (candidate !== currentMain)
    return decideDeployment({
      eventName,
      candidate,
      currentMain,
      running: null,
      relation: null,
      paths: [],
    });

  let running = null;
  try {
    running = await readRevision({ url: deploymentUrl });
  } catch {
    // The public endpoint can be unavailable during an outage. That is never
    // evidence for skipping the current main revision.
  }
  if (running === null || running === candidate)
    return decideDeployment({
      eventName,
      candidate,
      currentMain,
      running,
      relation: null,
      paths: [],
    });

  if (!git.hasCommit(running))
    throw new Error('Confirmed production revision is absent from repository history');
  const relation = git.isAncestor(running, candidate)
    ? 'running-ancestor'
    : git.isAncestor(candidate, running)
      ? 'candidate-behind'
      : 'diverged';
  return decideDeployment({
    eventName,
    candidate,
    currentMain,
    running,
    relation,
    paths: relation === 'running-ancestor' ? git.changedPaths(running, candidate) : [],
  });
}

async function writeResult(result) {
  if (!process.env.GITHUB_OUTPUT) throw new Error('GITHUB_OUTPUT is required');
  await appendFile(
    process.env.GITHUB_OUTPUT,
    `deploy=${String(result.deploy)}\nreason=${result.reason}\n`,
  );
  if (process.env.GITHUB_STEP_SUMMARY) {
    const action = result.deploy
      ? 'Build and deploy the application images.'
      : 'Skip application images.';
    const baseline = result.running ? `\n- Confirmed running revision: \`${result.running}\`` : '';
    await appendFile(
      process.env.GITHUB_STEP_SUMMARY,
      `### Application deployment selection\n\n- Decision: **${action}**\n- Reason: \`${result.reason}\`${baseline}\n`,
    );
  }
  console.log(
    `Application deployment selection: ${result.deploy ? 'deploy' : 'skip'} (${result.reason})`,
  );
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const result = await selectDeployment({
      eventName: process.env.DEPLOYMENT_EVENT,
      candidate: process.env.DEPLOYMENT_CANDIDATE,
      deploymentUrl: process.env.DEPLOYMENT_URL,
    });
    await writeResult(result);
  } catch {
    console.error(
      'Application deployment selection failed safely. No images were published or deployment requested.',
    );
    process.exitCode = 1;
  }
}
