import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';

// ADR-083: the two OpenSSF Scorecard checks a workflow edit can drop to 0.
// Token-Permissions: write access is granted to a job, never the workflow.
// Dangerous-Workflow: no pull_request_target, no checkout of a ref the event
// or anything indirect names, and no event value expanded inside a script
// (it reaches a script through env).

interface Step {
  uses?: string;
  run?: string;
  with?: Record<string, unknown>;
}
interface Workflow {
  on?: unknown;
  permissions?: unknown;
  jobs?: Record<string, { steps?: Step[] }>;
}

const UNTRUSTED = /github\.(event\.|head_ref)/;

/** The bodies of every `${{ … }}` in a script, whole, braces and all. */
const expressions = (text: string) =>
  [...text.matchAll(/\$\{\{([\s\S]*?)\}\}/g)].map((match) => match[1] ?? '');

/** Everything that breaks the rules above, as "where: what". */
function problems(workflow: Workflow): string[] {
  const found: string[] = [];

  const top = workflow.permissions;
  if (top === undefined) found.push('permissions: missing at the top level');
  else if (typeof top === 'string') {
    if (top !== 'read-all') found.push(`permissions: ${top}`);
  } else if (typeof top === 'object' && top !== null) {
    for (const [scope, level] of Object.entries(top))
      if (level !== 'read' && level !== 'none')
        found.push(`permissions.${scope}: ${String(level)}`);
  } else found.push('permissions: not a map');

  const triggers =
    typeof workflow.on === 'string'
      ? [workflow.on]
      : Array.isArray(workflow.on)
        ? workflow.on.map(String)
        : Object.keys(workflow.on ?? {});
  if (triggers.includes('pull_request_target')) found.push('on: pull_request_target');

  for (const [name, job] of Object.entries(workflow.jobs ?? {}))
    for (const [i, step] of (job.steps ?? []).entries()) {
      const where = `jobs.${name}.steps[${i}]`;
      const ref = step.with?.ref;
      // Only a literal or github.sha: env and inputs can carry an event value.
      if (step.uses?.startsWith('actions/checkout@') && ref !== undefined)
        if (expressions(String(ref)).some((body) => body.trim() !== 'github.sha'))
          found.push(`${where}: checkout ref ${String(ref)}`);
      const script = step.uses?.startsWith('actions/github-script@')
        ? step.with?.script
        : undefined;
      for (const [kind, text] of [
        ['run', step.run],
        ['script', script],
      ] as const)
        if (typeof text === 'string' && expressions(text).some((body) => UNTRUSTED.test(body)))
          found.push(`${where}: event value inside ${kind}`);
    }

  return found;
}

const dir = '.github/workflows';
const files = readdirSync(dir).filter((file) => /\.ya?ml$/.test(file));

describe('workflow hardening', () => {
  it('finds the workflows', () => {
    expect(files.length).toBeGreaterThanOrEqual(5);
  });

  for (const file of files)
    it(`${file} grants writes per job and never runs what the event names`, () => {
      expect(problems(parse(readFileSync(join(dir, file), 'utf8')) as Workflow)).toEqual([]);
    });

  it('catches each way of breaking the rules', () => {
    const checkout = 'actions/checkout@' + '0'.repeat(40);
    expect(problems({})).toEqual(['permissions: missing at the top level']);
    expect(problems({ permissions: 'write-all' })).toEqual(['permissions: write-all']);
    expect(problems({ permissions: { contents: 'write', actions: 'read' } })).toEqual([
      'permissions.contents: write',
    ]);
    expect(
      problems({
        permissions: {},
        jobs: {
          a: {
            steps: [
              { uses: checkout, with: { ref: '${{ github.event.workflow_run.head_sha }}' } },
              { uses: checkout, with: { ref: '${{ github.head_ref }}' } },
              { run: 'echo "${{ github.event.pull_request.title }}"' },
              { run: 'echo "${{ format(\'{0}\', github.event.pull_request.title) }}"' },
              { uses: checkout, with: { ref: '${{ env.HEAD }}' } },
              {
                uses: 'actions/github-script@' + '0'.repeat(40),
                with: { script: 'core.info(`${{ github.event.issue.title }}`)' },
              },
            ],
          },
        },
      }),
    ).toEqual([
      'jobs.a.steps[0]: checkout ref ${{ github.event.workflow_run.head_sha }}',
      'jobs.a.steps[1]: checkout ref ${{ github.head_ref }}',
      'jobs.a.steps[2]: event value inside run',
      'jobs.a.steps[3]: event value inside run',
      'jobs.a.steps[4]: checkout ref ${{ env.HEAD }}',
      'jobs.a.steps[5]: event value inside script',
    ]);
    expect(problems({ on: { pull_request_target: {} }, permissions: {} })).toEqual([
      'on: pull_request_target',
    ]);
    expect(problems({ on: ['push', 'pull_request_target'], permissions: {} })).toEqual([
      'on: pull_request_target',
    ]);
    expect(
      problems({
        permissions: { contents: 'read' },
        jobs: {
          a: {
            steps: [{ uses: checkout, with: { ref: '${{ github.sha }}' } }, { run: 'echo "$X"' }],
          },
        },
      }),
    ).toEqual([]);
  });
});
