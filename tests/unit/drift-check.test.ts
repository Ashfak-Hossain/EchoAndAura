import { spawnSync } from 'node:child_process';
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { parse } from 'yaml';

// ADR-089: the weekly drift check. The repository is public, so its Actions
// logs and issues are too: a plan's output must never reach either. The
// credentials stay in one job that can't write; the job that writes the
// issue holds none.

interface Step {
  id?: string;
  uses?: string;
  run?: string;
  env?: Record<string, string>;
  with?: Record<string, unknown>;
}
interface Job {
  if?: string;
  needs?: string;
  environment?: string;
  permissions?: Record<string, string>;
  env?: Record<string, string>;
  steps: Step[];
}
const workflow = parse(readFileSync('.github/workflows/drift.yml', 'utf8')) as {
  on: Record<string, unknown>;
  permissions: unknown;
  jobs: Record<string, Job>;
};
const { plan, report } = workflow.jobs as { plan: Job; report: Job };
const script = 'ops/terraform/drift-plan.sh';
const tf = readFileSync('ops/terraform/aws/drift_check.tf', 'utf8');

describe('drift workflow', () => {
  it('runs weekly and by hand, never for a pull request', () => {
    expect(Object.keys(workflow.on).sort()).toEqual(['schedule', 'workflow_dispatch']);
    expect(workflow.permissions).toEqual({});
  });

  it('keeps the credentials in plan, which cannot write', () => {
    expect(plan.environment).toBe('drift');
    expect(plan.permissions).toEqual({ contents: 'read', 'id-token': 'write' });
    expect(plan.steps.map((s) => s.run).filter(Boolean)).toEqual([
      `${script} aws`,
      `${script} cloudflare`,
    ]);
  });

  it('writes the issue from a job with no secrets and no checkout', () => {
    expect(report.permissions).toEqual({ issues: 'write' });
    expect(report.environment).toBeUndefined();
    expect(report.if).toBe('${{ !cancelled() }}');
    const text = JSON.stringify(report);
    expect(text).not.toMatch(/secrets\./);
    expect(text).not.toMatch(/actions\/checkout/);
  });

  it('signs in to AWS by OIDC into the profile the .tf files name', () => {
    const signIn = plan.steps.find((s) => s.uses?.startsWith('aws-actions/'));
    expect(signIn?.with).toMatchObject({
      'aws-profile': 'echoandaura',
      'role-duration-seconds': 900,
      'mask-aws-account-id': true,
    });
    expect(signIn?.with).not.toHaveProperty('aws-access-key-id');
  });
});

describe('drift_check.tf', () => {
  it('trusts only the drift environment of this repository', () => {
    expect(tf).toContain(
      '"token.actions.githubusercontent.com:sub" = "repo:${local.github_repo}:environment:drift"',
    );
    expect(tf).toContain('"token.actions.githubusercontent.com:aud" = "sts.amazonaws.com"');
    expect(tf).not.toMatch(/StringLike/);
  });

  it('denies reading any object but the state files', () => {
    expect(tf).toMatch(
      /Effect\s+= "Deny"\s+Action\s+= "s3:GetObject\*"\s+NotResource = "arn:aws:s3:::\$\{local\.state_bucket\}\/\*"/,
    );
  });

  it('denies reading stored values and buyer addresses', () => {
    const denied = tf.match(/Sid\s+= "NoStoredValues"[\s\S]*?Action = \[([\s\S]*?)\]/)?.[1] ?? '';
    for (const action of [
      'secretsmanager:GetSecretValue',
      'ssm:GetParameter*',
      'kms:Decrypt',
      'logs:Get*',
      'dynamodb:Scan',
      'ses:ListSuppressedDestinations',
      'ses:GetSuppressedDestination',
    ]) {
      expect(denied, action).toContain(`"${action}"`);
    }
  });
});

describe('drift-plan.sh', () => {
  // A fake terraform on PATH: prints something private, as a real plan
  // would, then exits with the code the test asks for.
  const bin = mkdtempSync(join(tmpdir(), 'drift-'));
  writeFileSync(
    join(bin, 'terraform'),
    [
      '#!/usr/bin/env bash',
      'echo "PRIVATE-ID-123 someone@example.com"',
      'echo "PRIVATE-ERR" >&2',
      'if [ "$1" = init ]; then exit "${FAKE_INIT:-0}"; fi',
      'printf "%s\\n" "$@" > "$FAKE_ARGS"',
      'exit "${FAKE_PLAN:-0}"',
    ].join('\n'),
  );
  chmodSync(join(bin, 'terraform'), 0o755);
  afterAll(() => rmSync(bin, { recursive: true, force: true }));

  const run = (module: string, env: Record<string, string> = {}) => {
    const out = join(bin, 'github_output');
    const args = join(bin, 'args');
    writeFileSync(out, '');
    const result = spawnSync('bash', [script, module], {
      encoding: 'utf8',
      env: {
        ...process.env,
        PATH: `${bin}:${process.env.PATH ?? ''}`,
        GITHUB_OUTPUT: out,
        FAKE_ARGS: args,
        ...env,
      },
    });
    return { ...result, output: readFileSync(out, 'utf8') };
  };

  it.each([
    ['0', 'clean'],
    ['2', 'drift'],
    ['1', 'failed'],
  ])('plan exit %s is %s, and nothing private is printed', (code, word) => {
    const r = run('aws', { FAKE_PLAN: code });
    expect(r.status).toBe(0);
    expect(r.stdout).toBe(`aws: ${word}\n`);
    expect(r.stderr).toBe('');
    expect(r.output).toBe(`result=${word}\n`);
  });

  it('a failed init is failed, without running plan', () => {
    const r = run('cloudflare', { FAKE_INIT: '1', FAKE_PLAN: '0' });
    expect(r.stdout).toBe('cloudflare: failed\n');
    expect(r.stdout + r.stderr).not.toMatch(/PRIVATE/);
  });

  it('plans without the lock, from the lock file, with detailed exit codes', () => {
    run('aws');
    const args = readFileSync(join(bin, 'args'), 'utf8').trim().split('\n');
    expect(args).toEqual([
      'plan',
      '-input=false',
      '-lock=false',
      '-detailed-exitcode',
      '-no-color',
    ]);
    expect(readFileSync(script, 'utf8')).toContain('init -input=false -lockfile=readonly');
  });

  it('refuses any other module', () => {
    const r = run('../../etc');
    expect(r.status).toBe(64);
    expect(r.output).toBe('');
  });
});
