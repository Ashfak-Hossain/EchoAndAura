import { readdirSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';

interface Step {
  name?: string;
  uses?: string;
  run?: string;
  env?: Record<string, string>;
}
const workflow = parse(readFileSync('.github/workflows/deploy.yml', 'utf8')) as {
  env: Record<string, string>;
  jobs: { images: { steps: Step[] } };
};
const steps = workflow.jobs.images.steps;
const at = (name: string) => steps.findIndex((step) => step.name === name);
const scan = steps[at('Scan images')];

// ADR-069: the deploy's image-scan gate.
describe('the image-scan gate', () => {
  it('scans both built images before they are smoke-tested, pushed or deployed', () => {
    expect(scan).toBeDefined();
    expect(at('Build worker')).toBeLessThan(at('Scan images'));
    expect(at('Scan images')).toBeLessThan(at('Smoke test'));
    expect(at('Scan images')).toBeLessThan(at('Push'));
    expect(scan?.env).toMatchObject({
      WEB: expect.stringContaining('echoandaura-web:'),
      WORKER: expect.stringContaining('echoandaura-worker:'),
    });
  });

  it('fails on critical findings that have a fix, and only lists the high ones', () => {
    expect(scan?.run).toContain('--ignore-unfixed');
    expect(scan?.run).toContain('scan --severity CRITICAL --exit-code 1');
    expect(scan?.run).toContain('scan --severity HIGH --exit-code 0');
    expect(scan?.run).toContain('--ignorefile /scan/.trivyignore.yaml');
  });

  it('runs a digest-pinned scanner with no Docker socket and no secrets', () => {
    expect(workflow.env.TRIVY_IMAGE).toMatch(
      /^docker\.io\/aquasec\/trivy:\d+\.\d+\.\d+@sha256:[a-f0-9]{64}$/,
    );
    expect(scan?.run).toContain('"$TRIVY_IMAGE" image --input /scan/image.tar');
    expect(scan?.run).not.toContain('docker.sock');
    expect(JSON.stringify(scan)).not.toMatch(/secrets\./);
    expect(scan?.run).toContain("trap 'rm -f image.tar' EXIT");
  });

  it("uses none of Trivy's GitHub Actions in any workflow (CVE-2026-33634)", () => {
    for (const file of readdirSync('.github/workflows')) {
      expect(readFileSync(`.github/workflows/${file}`, 'utf8'), file).not.toMatch(
        /uses:\s*aquasecurity\//,
      );
    }
  });

  it('keeps every accepted finding explained and expiring', () => {
    const { vulnerabilities } = parse(readFileSync('.trivyignore.yaml', 'utf8')) as {
      vulnerabilities: { id?: string; statement?: string; expired_at?: string }[];
    };
    expect(Array.isArray(vulnerabilities)).toBe(true);
    for (const entry of vulnerabilities) {
      expect(entry.id).toMatch(/^(CVE|GHSA)-/);
      expect(entry.statement?.trim()).toBeTruthy();
      expect(String(entry.expired_at)).toMatch(/^\d{4}-\d{2}-\d{2}/);
    }
  });
});
