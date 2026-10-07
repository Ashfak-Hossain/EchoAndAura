import { appendFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const shaPattern = /^[a-f0-9]{40}$/;
export function isConfirmedDeployment(value, revision) {
  return (
    value !== null &&
    typeof value === 'object' &&
    !Array.isArray(value) &&
    Object.keys(value).length === 2 &&
    value.ready === true &&
    typeof value.revision === 'string' &&
    shaPattern.test(value.revision) &&
    value.revision === revision
  );
}

async function readReport(response) {
  if (
    response.status !== 200 ||
    !(response.headers.get('cache-control') ?? '')
      .split(',')
      .some((directive) => directive.trim().toLowerCase() === 'no-store') ||
    !/^application\/json\b/i.test(response.headers.get('content-type') ?? '')
  )
    throw new Error('Deployment evidence unavailable');
  const reader = response.body?.getReader();
  if (!reader) throw new Error('Deployment evidence unavailable');
  let text = '';
  let size = 0;
  const decoder = new TextDecoder();
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > 1024) throw new Error('Deployment evidence unavailable');
      text += decoder.decode(value, { stream: true });
    }
    return JSON.parse(text + decoder.decode());
  } finally {
    await reader.cancel().catch(() => undefined);
    reader.releaseLock();
  }
}

export async function waitForDeployment({
  url,
  revision,
  timeoutMs = 300_000,
  intervalMs = 5_000,
  requestTimeoutMs = 5_000,
  fetchImpl = fetch,
  now = () => performance.now(),
  sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
}) {
  const endpoint = new URL(url);
  const loopback = ['localhost', '127.0.0.1', '[::1]'].includes(endpoint.hostname);
  if (
    !shaPattern.test(revision) ||
    endpoint.username ||
    endpoint.password ||
    endpoint.search ||
    endpoint.hash ||
    endpoint.pathname !== '/api/deployment' ||
    !(endpoint.protocol === 'https:' || (loopback && endpoint.protocol === 'http:')) ||
    ![timeoutMs, intervalMs, requestTimeoutMs].every((ms) => Number.isSafeInteger(ms) && ms > 0) ||
    timeoutMs > 600_000
  )
    throw new Error('Invalid deployment confirmation configuration');
  const deadline = now() + timeoutMs;
  while (now() < deadline) {
    const controller = new AbortController();
    let timer;
    try {
      const attempt = (async () => {
        const response = await fetchImpl(endpoint.href, {
          redirect: 'error',
          cache: 'no-store',
          headers: { Accept: 'application/json' },
          signal: controller.signal,
        });
        return isConfirmedDeployment(await readReport(response), revision);
      })();
      const timeout = new Promise((_, reject) => {
        timer = setTimeout(
          () => reject(new Error('Deployment evidence unavailable')),
          Math.max(1, Math.min(requestTimeoutMs, Math.ceil(deadline - now()))),
        );
      });
      if (await Promise.race([attempt, timeout])) return revision;
    } catch {
      // A rolling restart, old worker, cache or private error is never confirmation.
      // Do not print the URL, response body, request error or environment.
    } finally {
      clearTimeout(timer);
      controller.abort();
    }
    await sleep(Math.max(0, Math.min(intervalMs, Math.ceil(deadline - now()))));
  }
  throw new Error('Deployment was requested but the expected healthy revision was not confirmed');
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const revision = await waitForDeployment({
      url: process.env.DEPLOYMENT_URL,
      revision: process.env.DEPLOYMENT_REVISION,
      timeoutMs: Number(process.env.DEPLOYMENT_TIMEOUT_MS ?? 300_000),
    });
    console.log(`Healthy web and worker revision confirmed: ${revision}`);
    if (process.env.GITHUB_STEP_SUMMARY)
      await appendFile(
        process.env.GITHUB_STEP_SUMMARY,
        `### Deployment confirmed\n\nPublic commit: \`${revision}\`. Web and both worker queues reported matching fresh evidence and healthy dependencies.\n`,
      );
  } catch {
    console.error(
      'Deployment confirmation failed. Check the deployment and rollback pin; no revision was confirmed.',
    );
    process.exitCode = 1;
  }
}
