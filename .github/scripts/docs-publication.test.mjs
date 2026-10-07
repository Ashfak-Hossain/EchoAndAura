import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { packageArtifact, validatePackage, validateSite } from './docs-artifact.mjs';
import { selectArtifact, selectRelease } from './docs-release.mjs';
import { validateProject } from './docs-project.mjs';

const repository = 'example/project';
const sha = 'a'.repeat(40);

test('uploader requires an existing static Direct Upload project with no app secrets or bindings', () => {
  const data = {
    success: true,
    result: {
      name: 'echoandaura-docs',
      production_branch: 'main',
      source: null,
      uses_functions: false,
      deployment_configs: { production: { env_vars: {} }, preview: { env_vars: {} } },
    },
  };
  assert.doesNotThrow(() => validateProject(data));
  assert.throws(() => validateProject({ success: false }));
  for (const changes of [
    { name: 'other' },
    { production_branch: 'other' },
    { source: { type: 'github' } },
    { uses_functions: true },
    { deployment_configs: { production: { env_vars: { PRIVATE: { type: 'secret_text' } } } } },
    { deployment_configs: { preview: { r2_buckets: { DATA: { name: 'example' } } } } },
  ])
    assert.throws(() => validateProject({ ...data, result: { ...data.result, ...changes } }));
});
const headers = await readFile(new URL('../../docs-site/public/_headers', import.meta.url), 'utf8');
const run = {
  id: 42,
  run_attempt: 2,
  status: 'completed',
  conclusion: 'success',
  event: 'push',
  path: '.github/workflows/ci.yml',
  head_branch: 'main',
  head_sha: sha,
  repository: { full_name: repository },
  head_repository: { full_name: repository },
};
const pr = {
  number: 10,
  state: 'open',
  base: { ref: 'main', repo: { full_name: repository } },
  head: { sha, repo: { full_name: repository } },
};

test('production needs green push CI at current main', () => {
  assert.deepEqual(selectRelease(run, repository, sha), {
    branch: 'main',
    environment: 'docs-production',
    sha,
  });
  for (const changes of [
    { conclusion: 'failure' },
    { status: 'in_progress' },
    { event: 'workflow_dispatch' },
    { head_branch: 'other' },
    { path: '.github/workflows/other.yml' },
    { head_repository: { full_name: 'fork/project' } },
    { repository: { full_name: 'other/project' } },
    { head_sha: 'not-a-revision' },
  ])
    assert.equal(selectRelease({ ...run, ...changes }, repository, sha), null);
  assert.equal(selectRelease(run, repository, 'b'.repeat(40)), null);
});

test('a PR cannot select production even if its branch is named main', () => {
  const preview = { ...run, event: 'pull_request' };
  assert.deepEqual(selectRelease(preview, repository, sha, [pr]), {
    branch: 'pr-10',
    environment: 'docs-preview',
    sha,
  });
  for (const changed of [
    { ...pr, state: 'closed' },
    { ...pr, number: -1 },
    { ...pr, head: { ...pr.head, sha: 'b'.repeat(40) } },
    { ...pr, head: { ...pr.head, repo: { full_name: 'fork/project' } } },
    { ...pr, base: { ...pr.base, ref: 'other' } },
    { ...pr, base: { ...pr.base, repo: { full_name: 'other/project' } } },
  ])
    assert.equal(selectRelease(preview, repository, sha, [changed]), null);
  assert.equal(selectRelease(preview, repository, sha, []), null);
  assert.equal(selectRelease(preview, repository, sha, [pr, { ...pr, number: 11 }]), null);
});

test('artifact selection is tied to this run, SHA and attempt, never latest-by-name', () => {
  const artifact = {
    id: 5,
    name: 'docs-site-42-2',
    expired: false,
    size_in_bytes: 200,
    workflow_run: { id: 42, head_sha: sha },
  };
  assert.equal(selectArtifact([artifact], run), 5);
  for (const changes of [
    { name: 'docs-site-42-1' },
    { expired: true },
    { size_in_bytes: 0 },
    { size_in_bytes: 300 * 1024 * 1024 },
    { workflow_run: { id: 43, head_sha: sha } },
    { workflow_run: { id: 42, head_sha: 'b'.repeat(40) } },
  ])
    assert.throws(() => selectArtifact([{ ...artifact, ...changes }], run));
  assert.throws(() => selectArtifact([artifact, artifact], run));
});

async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), 'echoandaura-docs-artifact-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const site = join(root, 'out');
  await mkdir(join(site, 'api'), { recursive: true });
  for (const path of ['index.html', '404.html', 'api/search', 'robots.txt', 'sitemap.xml'])
    await writeFile(join(site, path), 'static fixture');
  await writeFile(join(site, '_headers'), headers);
  return { root, site };
}

test('package contains only static files and a checked provenance manifest', async (t) => {
  const { root, site } = await fixture(t);
  const provenance = { repository, runId: '42', attempt: '2', headSha: sha };
  const artifact = join(root, 'artifact');
  await packageArtifact(site, artifact, { ...provenance, revision: sha }, headers);
  const files = await validatePackage(artifact, provenance, headers);
  assert.equal(Object.keys(files).length, 6);
  await assert.rejects(
    validatePackage(artifact, { ...provenance, attempt: '1' }, headers),
    /provenance/,
  );
  await writeFile(join(artifact, 'site/index.html'), 'changed after packaging');
  await assert.rejects(validatePackage(artifact, provenance, headers), /content mismatch/);
});

test('accepts real Next dynamic-route chunk and RSC file naming', async (t) => {
  const { site } = await fixture(t);
  await mkdir(join(site, '_next/static/chunks/app/docs/[[...slug]]'), { recursive: true });
  await writeFile(
    join(site, '_next/static/chunks/app/docs/[[...slug]]/page-ab123.js'),
    'static chunk',
  );
  await mkdir(join(site, 'docs'), { recursive: true });
  await writeFile(join(site, 'docs/__next.docs.$oc$slug.__PAGE__.txt'), 'static RSC payload');
  assert.equal(Object.keys(await validateSite(site, headers)).length, 8);
});

for (const path of [
  '_worker.js',
  '_worker.js/index.js',
  'functions/index.js',
  '_routes.json',
  '_redirects',
  '.env',
  'source.ts',
  'bundle.js.map',
  'wrangler.json',
  'docs/_headers',
]) {
  test(`rejects unexpected upload input: ${path}`, async (t) => {
    const { site } = await fixture(t);
    const parts = path.split('/');
    if (parts.length > 1) await mkdir(join(site, ...parts.slice(0, -1)), { recursive: true });
    await writeFile(join(site, path), 'not an allowed asset');
    await assert.rejects(validateSite(site, headers));
  });
}

test('rejects links, altered hosting config, missing pages and credential markers', async (t) => {
  const { root, site } = await fixture(t);
  await symlink(join(site, 'index.html'), join(site, 'linked.html'));
  await assert.rejects(validateSite(site, headers), /Unsafe/);
  await rm(join(site, 'linked.html'));
  await writeFile(join(site, '_headers'), '/*\n  Access-Control-Allow-Origin: *');
  await assert.rejects(validateSite(site, headers), /headers/);
  await writeFile(join(site, '_headers'), headers);
  // Synthetic header only, no key material. Keep literal secret-shaped text
  // out of the patch so the project's no-secrets edit guard stays useful.
  await writeFile(join(site, 'key.txt'), ['-----BEGIN', 'PRIVATE KEY-----'].join(' '));
  await assert.rejects(validateSite(site, headers), /credential/);
  await rm(join(site, 'key.txt'));
  await rm(join(site, '404.html'));
  await assert.rejects(validateSite(site, headers), /Incomplete/);
  await symlink(site, join(root, 'linked-site'));
  await assert.rejects(validateSite(join(root, 'linked-site'), headers), /real directory/);
});

test('rejects extra artifact entries and an unsafe manifest', async (t) => {
  const { root, site } = await fixture(t);
  const provenance = { repository, runId: '42', attempt: '2', headSha: sha };
  const artifact = join(root, 'artifact');
  await packageArtifact(site, artifact, { ...provenance, revision: sha }, headers);
  await writeFile(join(artifact, 'extra.txt'), 'unexpected');
  await assert.rejects(validatePackage(artifact, provenance, headers), /entries/);
  await rm(join(artifact, 'extra.txt'));
  await rm(join(artifact, 'manifest.json'));
  await symlink(join(site, 'index.html'), join(artifact, 'manifest.json'));
  await assert.rejects(validatePackage(artifact, provenance, headers), /manifest/);
});
