import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';

describe('docs publication trust boundary', () => {
  const text = readFileSync('.github/workflows/docs-deploy.yml', 'utf8');
  const workflow = parse(text);
  const ci = parse(readFileSync('.github/workflows/ci.yml', 'utf8'));

  it('is disabled by default and triggered only by completed CI', () => {
    expect(workflow.on).toEqual({ workflow_run: { workflows: ['CI'], types: ['completed'] } });
    expect(workflow.jobs.select.if).toBe("vars.DOCS_PUBLISH_ENABLED == 'true'");
    expect(workflow.permissions).toEqual({
      contents: 'read',
      actions: 'read',
      'pull-requests': 'read',
    });
    expect(text).not.toContain('pull_request_target');
  });

  it('uses trusted default-branch code, never runs artifact code or a PR install', () => {
    for (const job of Object.values(workflow.jobs) as { steps: Record<string, unknown>[] }[]) {
      const checkout = job.steps.find((step) => step.uses === 'actions/checkout@v7');
      expect(checkout?.with).toEqual({ ref: '${{ github.sha }}', 'persist-credentials': false });
    }
    // Check executable steps; comments also explain forbidden patterns.
    const runs: string[] = workflow.jobs.publish.steps.map(
      (step: { run?: string }) => step.run ?? '',
    );
    expect(runs.join('\n')).not.toContain('pnpm install');
    expect(runs.join('\n')).not.toContain('pnpm build');
    expect(workflow.jobs.publish.environment).toBe('${{ needs.select.outputs.environment }}');
    expect(workflow.jobs.publish.steps.at(-1)['working-directory']).toBe('${{ runner.temp }}');
  });

  it('exposes Cloudflare credentials only to the final upload, after validation and recheck', () => {
    const steps = workflow.jobs.publish.steps;
    const credentialSteps = steps.filter(
      (step: { env?: Record<string, string> }) => step.env?.CLOUDFLARE_API_TOKEN,
    );
    expect(credentialSteps).toEqual([steps.at(-1)]);
    expect(steps.at(-1).env.CLOUDFLARE_API_TOKEN).toBe('${{ secrets.CLOUDFLARE_PAGES_API_TOKEN }}');
    const runs: string[] = steps.map((step: { run?: string }) => step.run ?? '');
    expect(runs.findIndex((run) => run.includes('docs-artifact.mjs validate'))).toBeLessThan(
      runs.findIndex((run) => run.includes('npm install')),
    );
    expect(steps.at(-2).id).toBe('current');
    expect(steps.at(-1).if).toContain("steps.current.outputs.publish == 'true'");
    expect(steps.at(-1).run).toContain('--branch="$DOCS_BRANCH"');
    expect(steps.at(-1).run).toContain('--project-name=echoandaura-docs');
    expect(steps.at(-1).run).toContain('test -n "$CLOUDFLARE_API_TOKEN"');
    expect(steps.at(-1).run).toContain('node "$GITHUB_WORKSPACE/.github/scripts/docs-project.mjs"');
  });

  it('packages only after the full verify, browser and Postgres gates', () => {
    const steps = ci.jobs.verify.steps;
    const artifact = steps.findIndex(
      (step: { name?: string }) => step.name === 'Package docs export',
    );
    for (const command of ['pnpm verify', 'pnpm docs:test', 'pnpm test:integration:db'])
      expect(steps.findIndex((step: { run?: string }) => step.run === command)).toBeLessThan(
        artifact,
      );
    expect(steps.at(-1).with.path).toBe('${{ runner.temp }}/docs-artifact');
    expect(steps.at(-1).with.name).toBe('docs-site-${{ github.run_id }}-${{ github.run_attempt }}');
    expect(steps.at(-1).with['if-no-files-found']).toBe('error');
    expect(JSON.stringify(ci)).not.toContain('CLOUDFLARE_PAGES_API_TOKEN');
  });
});
