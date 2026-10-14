import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';

// ADR-073: every action runs at a commit SHA. A tag can be moved to other
// code by whoever controls the action's repository (the threat ADR-069
// cites), and these jobs hold the GHCR, Dokploy and Cloudflare secrets. The
// trailing `# vX.Y.Z` is what Dependabot reads and moves with the SHA.

const REMOTE = /^[\w.-]+\/[\w.-]+(?:\/[\w./-]+)?@[0-9a-f]{40}$/;
const PINNED = /^[\w.-]+\/[\w.-]+(?:\/[\w./-]+)?@[0-9a-f]{40} # v\d+\.\d+\.\d+$/;
const LOCAL = /^\.\/[\w./-]+$/;
const DOCKER = /^docker:\/\/[\w./:-]+@sha256:[0-9a-f]{64}$/;
const USES_LINE = /^\s*(?:-\s+)?uses:\s*(.*?)\s*$/;

/** Every `uses:` line of a workflow that is not pinned, as "line N: value". */
function unpinned(text: string): string[] {
  return text.split('\n').flatMap((line, i) => {
    const value = USES_LINE.exec(line)?.[1];
    if (value === undefined) return [];
    return PINNED.test(value) || LOCAL.test(value) || DOCKER.test(value)
      ? []
      : [`line ${i + 1}: ${value}`];
  });
}

/** The `uses` values the YAML actually holds, at job and step level. */
function parsedUses(text: string): string[] {
  const workflow = parse(text) as {
    jobs?: Record<string, { uses?: string; steps?: { uses?: string }[] }>;
  };
  return Object.values(workflow.jobs ?? {}).flatMap((job) => [
    ...(job.uses === undefined ? [] : [job.uses]),
    ...(job.steps ?? []).flatMap((step) => (step.uses === undefined ? [] : [step.uses])),
  ]);
}

/**
 * Everything wrong with a whole workflow. The line scan checks the version
 * comment, which the YAML parser drops; the parsed values are checked too,
 * because a quoted key or a flow-style `{ uses: … }` hides from the scan and a
 * decoy `uses:` line inside a script could balance a count.
 */
function problems(text: string): string[] {
  const parsed = parsedUses(text);
  const lines = text.split('\n').filter((line) => USES_LINE.test(line)).length;
  return [
    ...unpinned(text),
    ...parsed.filter((uses) => ![REMOTE, LOCAL, DOCKER].some((re) => re.test(uses))),
    ...(lines === parsed.length ? [] : [`${lines} uses: lines, ${parsed.length} uses`]),
  ];
}

const sha = 'a'.repeat(40);

describe('the pin check', () => {
  it.each([
    ['a step', `      - uses: actions/checkout@${sha} # v7.0.1`],
    ['a named step', `        uses: docker/build-push-action@${sha} # v7.4.0`],
    ['a sub-path action', `      - uses: github/codeql-action/init@${sha} # v3.28.0`],
    ['a reusable workflow', `    uses: org/repo/.github/workflows/x.yml@${sha} # v1.2.0`],
    ['a local action', `      - uses: ./.github/actions/setup`],
    ['a docker image by digest', `      - uses: docker://alpine@sha256:${'b'.repeat(64)}`],
  ])('accepts %s', (_, line) => {
    expect(unpinned(line)).toEqual([]);
  });

  it.each([
    ['a major tag', `      - uses: actions/checkout@v7`],
    ['an exact tag', `      - uses: astral-sh/setup-uv@v10.2.0`],
    ['a branch', `      - uses: actions/checkout@main`],
    ['a short SHA', `      - uses: actions/checkout@${'a'.repeat(7)} # v7.0.1`],
    ['a 39-character SHA', `      - uses: actions/checkout@${'a'.repeat(39)} # v7.0.1`],
    ['an uppercase SHA', `      - uses: actions/checkout@${'A'.repeat(40)} # v7.0.1`],
    ['a SHA without its version', `      - uses: actions/checkout@${sha}`],
    ['a SHA with a stray comment', `      - uses: actions/checkout@${sha} # latest`],
    ['a SHA with only its major', `      - uses: actions/checkout@${sha} # v7`],
    ['a quoted tag', `      - uses: 'actions/checkout@v7'`],
    ['a reusable workflow on a tag', `    uses: org/repo/.github/workflows/x.yml@v1`],
    ['a docker image by tag', `      - uses: docker://alpine:3.20`],
    ['no ref at all', `      - uses: actions/checkout`],
  ])('refuses %s', (_, line) => {
    expect(unpinned(line)).toHaveLength(1);
  });

  it('names the line it refuses', () => {
    const text = ['steps:', `  - uses: actions/checkout@${sha} # v7.0.1`, '  - uses: x/y@v1'];
    expect(unpinned(text.join('\n'))).toEqual(['line 3: x/y@v1']);
  });
});

describe('the whole-workflow check', () => {
  const pin = (name: string) => `${name}@${sha} # v1.0.0`;
  const workflow = (...steps: string[]) =>
    ['jobs:', '  build:', '    steps:', ...steps.map((step) => `      ${step}`)].join('\n');

  it('accepts pinned steps', () => {
    expect(problems(workflow(`- uses: ${pin('a/b')}`, `- uses: ${pin('c/d')}`))).toEqual([]);
  });

  it.each([
    ['a flow-style step', workflow('- { uses: evil/act@main }')],
    ['a quoted key', workflow(`- "uses": actions/checkout@v7`)],
    [
      'a decoy line in a script balancing a quoted key',
      workflow('- run: |', `    uses: ${pin('x/y')}`, '- "uses": actions/checkout@v7'),
    ],
    [
      'a decoy line under with: balancing a flow-style step',
      workflow(
        `- uses: ${pin('a/b')}`,
        '  with:',
        `    uses: ${pin('x/y')}`,
        '- {uses: evil/act@main}',
      ),
    ],
  ])('refuses %s', (_, text) => {
    expect(problems(text)).not.toEqual([]);
  });
});

describe('the workflows', () => {
  const dir = '.github/workflows';
  const files = readdirSync(dir).filter((f) => /\.ya?ml$/.test(f));

  it('exist and use actions, so the check below is not vacuous', () => {
    expect(files.length).toBeGreaterThan(0);
    const total = files.reduce(
      (n, f) => n + parsedUses(readFileSync(join(dir, f), 'utf8')).length,
      0,
    );
    expect(total).toBeGreaterThan(0);
  });

  it.each(files)('%s pins every action to a commit SHA', (file) => {
    expect(problems(readFileSync(join(dir, file), 'utf8'))).toEqual([]);
  });
});
