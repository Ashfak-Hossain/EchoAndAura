import { appendFile, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// Fail closed. Neither the artifact nor a contributor-supplied branch name
// chooses production. A same-repository PR always uses our own pr-N branch.
export function selectRelease(run, repository, mainSha, prs = []) {
  if (
    run.status !== 'completed' ||
    run.conclusion !== 'success' ||
    run.path !== '.github/workflows/ci.yml' ||
    run.repository?.full_name !== repository ||
    run.head_repository?.full_name !== repository ||
    !/^[a-f0-9]{40}$/.test(run.head_sha)
  )
    return null;
  if (run.event === 'push' && run.head_branch === 'main' && run.head_sha === mainSha)
    return { branch: 'main', environment: 'docs-production', sha: run.head_sha };
  if (run.event !== 'pull_request') return null;
  const candidates = prs.filter(
    (pr) =>
      pr.state === 'open' &&
      pr.base?.ref === 'main' &&
      pr.base?.repo?.full_name === repository &&
      pr.head?.repo?.full_name === repository &&
      pr.head?.sha === run.head_sha &&
      Number.isSafeInteger(pr.number) &&
      pr.number > 0,
  );
  if (candidates.length !== 1) return null;
  return { branch: `pr-${candidates[0].number}`, environment: 'docs-preview', sha: run.head_sha };
}

export function selectArtifact(artifacts, run) {
  const name = `docs-site-${run.id}-${run.run_attempt}`;
  const matches = artifacts.filter(
    (artifact) =>
      artifact.name === name &&
      !artifact.expired &&
      artifact.size_in_bytes > 0 &&
      artifact.size_in_bytes < 250 * 1024 * 1024 &&
      artifact.workflow_run?.id === run.id &&
      artifact.workflow_run?.head_sha === run.head_sha,
  );
  if (matches.length !== 1) throw new Error('Missing, expired or ambiguous checked docs artifact');
  return matches[0].id;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const event = JSON.parse(await readFile(process.env.GITHUB_EVENT_PATH, 'utf8'));
  const repository = process.env.GITHUB_REPOSITORY;
  if (!/^[-\w]+\/[-.\w]+$/.test(repository) || !Number.isSafeInteger(event.workflow_run?.id))
    throw new Error('Invalid deployment event');
  async function api(path) {
    const response = await fetch(`https://api.github.com/repos/${repository}/${path}`, {
      headers: {
        Authorization: `Bearer ${process.env.GH_TOKEN}`,
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
      },
    });
    // Never print API bodies, tokens, arbitrary PR text or artifact content.
    if (!response.ok) throw new Error(`GitHub read failed (${response.status})`);
    return response.json();
  }
  const run = await api(`actions/runs/${event.workflow_run.id}`);
  // A rerun which is still in progress must not borrow an earlier attempt's artifact.
  if (run.run_attempt !== event.workflow_run.run_attempt) throw new Error('CI attempt changed');
  const main = await api('git/ref/heads/main');
  let prs = [];
  if (run.event === 'pull_request' && run.head_repository?.full_name === repository) {
    const references = run.pull_requests?.length
      ? run.pull_requests
      : await api(`commits/${run.head_sha}/pulls`);
    if (references.length > 10) throw new Error('Ambiguous PR association');
    prs = await Promise.all(references.map((pr) => api(`pulls/${pr.number}`)));
  }
  const release = selectRelease(run, repository, main.object.sha, prs);
  if (!release) {
    await appendFile(process.env.GITHUB_OUTPUT, 'publish=false\n');
    console.log('No publication: CI is untrusted, unsuccessful or no longer current.');
  } else {
    const list = await api(`actions/runs/${run.id}/artifacts?per_page=100`);
    const artifact = selectArtifact(list.artifacts, run);
    await appendFile(
      process.env.GITHUB_OUTPUT,
      [
        'publish=true',
        `branch=${release.branch}`,
        `environment=${release.environment}`,
        `sha=${release.sha}`,
        `artifact=${artifact}`,
        `attempt=${run.run_attempt}`,
      ].join('\n') + '\n',
    );
    console.log(`Checked docs publication selected: ${release.branch}.`);
  }
}
