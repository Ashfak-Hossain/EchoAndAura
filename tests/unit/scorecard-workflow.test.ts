import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';

// ADR-082: the Scorecard job holds an id-token and may write to Code
// scanning, so its token is kept to that one job. Scorecard's API also
// refuses to publish a result from a job with extra steps, env, defaults or
// a container, which would silently freeze the badge.

type Step = { uses?: string; run?: string; with?: Record<string, unknown> };
type Job = Record<string, unknown> & { permissions?: unknown; steps: Step[] };

const workflow = parse(readFileSync('.github/workflows/scorecard.yml', 'utf8')) as Record<
  string,
  unknown
> & {
  permissions: unknown;
  jobs: Record<string, Job>;
};

describe('Scorecard workflow', () => {
  it('gives the token nothing at the top level', () => {
    expect(workflow.permissions).toEqual({});
  });

  it('has one job, with only the permissions Scorecard needs', () => {
    expect(Object.keys(workflow.jobs)).toEqual(['analysis']);
    expect(workflow.jobs.analysis.permissions).toEqual({
      contents: 'read',
      actions: 'read',
      'security-events': 'write',
      'id-token': 'write',
    });
  });

  it('keeps the job publishable: checkout, Scorecard, upload, nothing else', () => {
    const job = workflow.jobs.analysis;
    for (const key of ['env', 'defaults']) {
      expect(workflow).not.toHaveProperty(key);
    }
    for (const key of ['env', 'defaults', 'container', 'services']) {
      expect(job).not.toHaveProperty(key);
    }
    // The API accepts only GitHub-hosted Ubuntu runners.
    expect(job['runs-on']).toMatch(/^ubuntu-(latest|\d{2}\.\d{2})(-arm)?$/);
    const actions = job.steps.map((step) => step.uses?.split('@')[0]);
    expect(actions).toEqual([
      'actions/checkout',
      'ossf/scorecard-action',
      'github/codeql-action/upload-sarif',
    ]);
    expect(job.steps.some((step) => step.run !== undefined)).toBe(false);
  });

  it('does not keep the token in the checkout, and publishes without an admin token', () => {
    const [checkout, scorecard] = workflow.jobs.analysis.steps;
    expect(checkout?.with).toEqual({ 'persist-credentials': false });
    expect(scorecard?.with?.publish_results).toBe(true);
    expect(scorecard?.with).not.toHaveProperty('repo_token');
  });
});
