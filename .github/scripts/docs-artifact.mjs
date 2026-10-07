import { createHash } from 'node:crypto';
import { cp, lstat, mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const required = ['index.html', '404.html', 'api/search', 'robots.txt', 'sitemap.xml', '_headers'];
const extensions = /\.(?:html|txt|xml|json|js|css|woff2?|png|svg|ico|webp)$/;
const secretMarkers =
  /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----|\b(?:AKIA|ASIA)[A-Z0-9]{16}\b|\bgh[pousr]_[A-Za-z0-9]{30,}\b|\bgithub_pat_[A-Za-z0-9_]{50,}\b/;

// These checks are run again by trusted main-branch code in the publisher.
// An artifact is DATA, never a source of scripts/config for the privileged job.
export async function validateSite(directory, headers) {
  const root = resolve(directory);
  if (!(await lstat(root)).isDirectory() || (await lstat(root)).isSymbolicLink())
    throw new Error('Export must be a real directory');
  const hashes = {};
  let total = 0;
  async function visit(dir) {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      const file = join(dir, entry.name);
      const path = relative(root, file).replaceAll('\\', '/');
      const segments = path.split('/');
      if (
        // Next emits [[...slug]] chunk directories and $oc$slug RSC names.
        !/^[A-Za-z0-9_.$\[\]/-]+$/.test(path) ||
        segments.some((segment) => segment.startsWith('.') || segment === 'functions') ||
        segments.some((segment) => /^_worker\./.test(segment)) ||
        segments.some((segment) =>
          ['_routes.json', 'wrangler.json', 'wrangler.jsonc'].includes(segment),
        ) ||
        entry.isSymbolicLink()
      )
        throw new Error('Unsafe export entry');
      if (entry.isDirectory()) {
        await visit(file);
        continue;
      }
      if (
        !entry.isFile() ||
        !(path === '_headers' || path === 'api/search' || extensions.test(path))
      )
        throw new Error('Unexpected export file type');
      // Pages special files could enable execution, redirects or routing. Only
      // this exact, reviewed headers file is allowed; maps/raw sources are not.
      if (entry.name === '_headers' && path !== '_headers')
        throw new Error('Nested hosting config');
      const info = await lstat(file);
      total += info.size;
      if (
        info.size > 25 * 1024 * 1024 ||
        total > 200 * 1024 * 1024 ||
        Object.keys(hashes).length >= 10000
      )
        throw new Error('Export exceeds static upload limits');
      const bytes = await readFile(file);
      if (secretMarkers.test(bytes.toString('utf8')))
        throw new Error('Potential credential in export');
      hashes[path] = createHash('sha256').update(bytes).digest('hex');
    }
  }
  await visit(root);
  for (const path of required)
    if (!Object.hasOwn(hashes, path)) throw new Error('Incomplete export');
  if ((await readFile(join(root, '_headers'), 'utf8')) !== headers)
    throw new Error('Unreviewed hosting headers');
  return Object.fromEntries(Object.entries(hashes).sort(([a], [b]) => a.localeCompare(b)));
}

export async function packageArtifact(source, destination, provenance, headers) {
  const files = await validateSite(source, headers);
  const target = resolve(destination);
  // Build output only; never sweep the repository or its .env into an artifact.
  await mkdir(target, { recursive: false });
  await cp(source, join(target, 'site'), { recursive: true, dereference: false });
  await writeFile(
    join(target, 'manifest.json'),
    JSON.stringify({ schema: 1, ...provenance, files }),
  );
}

export async function validatePackage(directory, expected, headers) {
  const root = resolve(directory);
  const entries = (await readdir(root)).sort();
  if (JSON.stringify(entries) !== JSON.stringify(['manifest.json', 'site']))
    throw new Error('Unexpected artifact entries');
  const info = await lstat(join(root, 'manifest.json'));
  if (!info.isFile() || info.isSymbolicLink() || info.size > 2 * 1024 * 1024)
    throw new Error('Invalid manifest');
  const manifest = JSON.parse(await readFile(join(root, 'manifest.json'), 'utf8'));
  if (manifest.schema !== 1) throw new Error('Unknown artifact schema');
  for (const [key, value] of Object.entries(expected))
    if (manifest[key] !== value) throw new Error('Artifact provenance mismatch');
  if (!/^[a-f0-9]{40}$/.test(manifest.revision)) throw new Error('Invalid source revision');
  const files = await validateSite(join(root, 'site'), headers);
  if (JSON.stringify(files) !== JSON.stringify(manifest.files))
    throw new Error('Artifact content mismatch');
  return files;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const headers = await readFile(join(repositoryRoot, 'docs-site/public/_headers'), 'utf8');
  const provenance = {
    repository: process.env.GITHUB_REPOSITORY,
    runId: process.env.DOCS_RUN_ID,
    attempt: process.env.DOCS_RUN_ATTEMPT,
    headSha: process.env.DOCS_HEAD_SHA,
  };
  if (process.argv[2] === 'package') {
    await packageArtifact(
      resolve('docs-site/out'),
      process.argv[3],
      {
        ...provenance,
        revision: process.env.GITHUB_SHA,
      },
      headers,
    );
  } else if (process.argv[2] === 'validate') {
    await validatePackage(process.argv[3], provenance, headers);
  } else throw new Error('Expected package or validate');
  console.log('Static docs artifact checked; no artifact code was executed.');
}
