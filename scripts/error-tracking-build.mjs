import { readdir, readFile, unlink, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { SentryCli } from '@sentry/cli';

/** Explicit image-build opt-in only: normal verify/build never uploads anything. */
export function sourceMapSettings(env) {
  if (env.SENTRY_BUILD_SOURCEMAPS !== '1') return null;
  if (
    !/^[a-z0-9][a-z0-9_-]*$/.test(env.SENTRY_ORG ?? '') ||
    !/^[a-z0-9][a-z0-9_-]*$/.test(env.SENTRY_PROJECT ?? '') ||
    !env.SENTRY_AUTH_TOKEN
  ) {
    throw new Error(
      'Source-map builds require SENTRY_ORG, SENTRY_PROJECT and a BuildKit upload credential',
    );
  }
  return { org: env.SENTRY_ORG, project: env.SENTRY_PROJECT };
}

async function cli(args) {
  // Never put the upload credential into argv, output, build args, or image ENV.
  await new SentryCli(null, {}).execute(args, false);
}

/** Tags a failure with the step it happened in; the error itself is never printed. */
async function step(name, work) {
  try {
    return await work();
  } catch (error) {
    const tagged = error instanceof Error ? error : new Error('Non-error failure');
    tagged.stage ??= name;
    throw tagged;
  }
}

/**
 * CI logs are public and vendor/CLI output may echo URLs, slugs or request
 * details, so a failure maps to fixed wording only: the step, plus a reason
 * from this list with at most an HTTP status or curl error number.
 */
export function failureReason(error) {
  const stage = /^[a-z-]+$/.test(error?.stage ?? '') ? error.stage : 'unknown';
  const text = `${error?.stderr ?? ''}\n${error?.message ?? ''}`;
  const status = text.match(/http status: ([1-5]\d\d)\b/i)?.[1];
  const curl = text.match(/^\s*\d+: \[(\d{1,3})\] /m)?.[1];
  let reason;
  if (status === '401') reason = 'Sentry refused the upload credential (HTTP 401)';
  else if (status === '403') reason = 'the upload credential lacks permission (HTTP 403)';
  else if (status === '404') reason = 'organization or project not found (HTTP 404)';
  else if (status) reason = `Sentry answered HTTP ${status}`;
  else if (curl) reason = `could not reach Sentry (network error ${curl})`;
  else if (/No files to upload/i.test(text)) reason = 'no files to upload';
  else if (/two different org/i.test(text))
    reason = 'the credential belongs to a different organization than SENTRY_ORG';
  else if (/BuildKit upload credential/.test(text))
    reason = 'missing SENTRY_ORG, SENTRY_PROJECT or the BuildKit upload credential';
  else reason = 'unrecognised error';
  return `step ${stage}: ${reason}`;
}

async function removeMaps(directory) {
  let entries;
  try {
    entries = await readdir(directory, { withFileTypes: true });
  } catch (error) {
    if (error.code === 'ENOENT') return;
    throw error;
  }
  for (const entry of entries) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) await removeMaps(path);
    else if (entry.isFile() && entry.name.endsWith('.map')) await unlink(path);
  }
}

export async function normalizeMapReferences(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) await normalizeMapReferences(path);
    else if (entry.isFile() && /\.m?js$/.test(entry.name)) {
      const source = await readFile(path, 'utf8');
      const match = source.match(/\/\/# sourceMappingURL=([^\r\n]+)/);
      if (!match || !match[1].includes('%')) continue;
      // Turbopack URL-encodes brackets/parentheses; CLI 3.8 treats the reference
      // as a literal filesystem name and otherwise silently misses these maps.
      const decoded = decodeURIComponent(match[1]);
      if (!/^[^/\\\s?#]+\.map$/.test(decoded))
        throw new Error('Expected a local generated source-map filename');
      await readFile(join(dirname(path), decoded));
      await writeFile(path, source.replace(match[0], `//# sourceMappingURL=${decoded}`));
    }
  }
}

export async function injectNextMaps(distDir, env = process.env, execute = cli) {
  if (!(await step('settings', () => sourceMapSettings(env)))) return;
  const root = resolve(distDir);
  if (root !== resolve('.next-build'))
    throw Object.assign(new Error('Source maps require the isolated .next-build directory'), {
      stage: 'settings',
    });
  await step('normalize-maps', async () => {
    await normalizeMapReferences(join(root, 'static'));
    await normalizeMapReferences(join(root, 'server'));
  });
  // Runs before Next traces standalone files: shipped server code has the
  // same injected debug IDs as the files whose maps we upload later.
  await step('next-inject', () =>
    execute(['sourcemaps', 'inject', join(root, 'static'), join(root, 'server')]),
  );
}

export async function finishImageMaps(env = process.env, execute = cli) {
  const config = await step('settings', () => sourceMapSettings(env));
  if (config) {
    const metadata = await step('revision', async () => {
      const value = JSON.parse(await readFile('deployment-revision.json', 'utf8'));
      if (!/^[a-f0-9]{40}$/.test(value.revision ?? ''))
        throw new Error('Missing image-owned release revision');
      return value;
    });
    await step('worker-inject', () =>
      execute(['sourcemaps', 'inject', 'dist/worker.mjs', 'dist/worker.mjs.map']),
    );
    await step('upload', () =>
      execute([
        'sourcemaps',
        'upload',
        '--org',
        config.org,
        '--project',
        config.project,
        '--release',
        metadata.revision,
        '--validate',
        '--strict',
        '--wait-for',
        '120',
        '.next-build/static',
        '.next-build/server',
        'dist/worker.mjs',
        'dist/worker.mjs.map',
      ]),
    );
  }
  // These exact generated directories ship in the images. No public maps,
  // even if upload is disabled. Failed uploads stop the build before shipping.
  await step('cleanup', async () => {
    for (const directory of [
      '.next-build/static',
      '.next-build/server',
      '.next-build/standalone/.next-build/server',
    ])
      await removeMaps(directory);
    try {
      await unlink('dist/worker.mjs.map');
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const operation = process.argv[2];
  try {
    if (operation === 'inject-next') await injectNextMaps(process.argv[3]);
    else if (operation === 'finish-image') await finishImageMaps();
    else throw new Error('Unknown source-map build operation');
  } catch (error) {
    // Vendor errors may echo request details; CI only gets fixed wording.
    console.error(
      `Private source-map build failed (${failureReason(error)}); no images should be published.`,
    );
    process.exitCode = 1;
  }
}
