import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';

// ADR-075: every image the Deploy workflow pushes gets signed provenance and
// an SBOM, from a job that holds the signing token and nothing else; a
// version is only given to an image whose provenance checks out, by digest.

interface Step {
  name?: string;
  id?: string;
  if?: string;
  uses?: string;
  run?: string;
  with?: Record<string, unknown>;
  env?: Record<string, string>;
}
interface Job {
  needs?: string;
  if?: string;
  permissions: Record<string, string>;
  outputs?: Record<string, string>;
  steps: Step[];
}

const deploy = parse(readFileSync('.github/workflows/deploy.yml', 'utf8')) as {
  jobs: Record<string, Job>;
};
const release = parse(readFileSync('.github/workflows/release.yml', 'utf8')) as {
  permissions: Record<string, string>;
  jobs: { release: Job };
};
const images = deploy.jobs.images!;
const attest = deploy.jobs.attest!;
const at = (steps: Step[], name: string) => steps.findIndex((step) => step.name === name);

describe('the images job', () => {
  it('can not mint a signing token', () => {
    expect(images.permissions).toEqual({ contents: 'read', packages: 'write' });
  });

  it('skips a CI run main has moved past, so provenance never names the wrong commit', () => {
    expect(images.if).toContain("needs.selection.outputs.deploy == 'true'");
    expect(images.if).toContain(
      "(github.event_name != 'workflow_run' || github.event.workflow_run.head_sha == github.sha)",
    );
  });

  it('signs the digest GHCR acknowledged, and only if the tag still resolves to it', () => {
    const push = images.steps[at(images.steps, 'Push')];
    expect(push?.id).toBe('digests');
    const run = push?.run ?? '';
    expect(run).toContain('set -euo pipefail');
    const pushed = run.indexOf('pushed="$(docker push');
    expect(pushed).toBeGreaterThan(-1);
    expect(run).toMatch(/\[\[ "\$pushed" =~ \^sha256:\[0-9a-f\]\{64\}\$ \]\] \\\n\s+\|\| \{/);
    const readBack = run.indexOf('imagetools inspect');
    expect(readBack).toBeGreaterThan(pushed);
    expect(run).toMatch(/\[ "\$digest" = "\$pushed" \] \\\n\s+\|\| \{[^\n]*exit 1; \}/);
    expect(run.indexOf('echo "$name=$digest" >> "$GITHUB_OUTPUT"')).toBeGreaterThan(readBack);
    expect(images.outputs).toEqual({
      'web-digest': '${{ steps.digests.outputs.web }}',
      'worker-digest': '${{ steps.digests.outputs.worker }}',
    });
  });

  it('lists the packages of the same export it scans, for both images', () => {
    const scan = images.steps[at(images.steps, 'Scan images')]?.run ?? '';
    expect(scan).toContain('--format spdx-json');
    expect(scan).toContain('sbom "$name"');
    expect(scan).toContain('test -s "$SBOM_DIR/web.spdx.json"');
    expect(scan).toContain('test -s "$SBOM_DIR/worker.spdx.json"');
  });

  it('hands the SBOMs on before the deploy is requested', () => {
    const upload = images.steps.findIndex((s) => s.uses?.startsWith('actions/upload-artifact@'));
    // Before the push: a failed second push must not leave the first image
    // without its SBOM to sign.
    expect(upload).toBeGreaterThan(at(images.steps, 'Scan images'));
    expect(upload).toBeLessThan(at(images.steps, 'Push'));
    expect(images.steps[upload]?.with).toMatchObject({
      name: 'sbom',
      'if-no-files-found': 'error',
    });
  });
});

describe('the attest job', () => {
  it('holds only the signing permissions', () => {
    expect(attest.permissions).toEqual({ 'id-token': 'write', attestations: 'write' });
  });

  it('runs whenever an image was pushed, even if a later step failed', () => {
    expect(attest.needs).toBe('images');
    expect(attest.if).toBe(
      "${{ !cancelled() && (needs.images.outputs.web-digest != '' || needs.images.outputs.worker-digest != '') }}",
    );
  });

  it('signs each image on its own digest, so one failed push leaves the other signed', () => {
    for (const step of attest.steps.filter((s) => s.uses?.startsWith('actions/attest@'))) {
      const image = String(step.with?.['subject-digest']).includes('web-digest') ? 'web' : 'worker';
      expect(step.if, step.name).toBe(`needs.images.outputs.${image}-digest != ''`);
    }
  });

  it('runs no shell and no third-party action', () => {
    for (const step of attest.steps) {
      expect(step.run, step.name).toBeUndefined();
      expect(step.uses, step.name).toMatch(/^actions\/(attest|download-artifact)@[0-9a-f]{40}$/);
    }
  });

  it('signs provenance and an SBOM for both images, by digest, without touching GHCR', () => {
    const signed = attest.steps
      .filter((s) => s.uses?.startsWith('actions/attest@'))
      .map((s) => ({
        digest: s.with?.['subject-digest'],
        sbom: s.with?.['sbom-path'] ?? null,
        push: s.with?.['push-to-registry'] ?? false,
      }));
    expect(signed).toEqual([
      { digest: '${{ needs.images.outputs.web-digest }}', sbom: null, push: false },
      { digest: '${{ needs.images.outputs.worker-digest }}', sbom: null, push: false },
      {
        digest: '${{ needs.images.outputs.web-digest }}',
        sbom: '${{ runner.temp }}/sbom/web.spdx.json',
        push: false,
      },
      {
        digest: '${{ needs.images.outputs.worker-digest }}',
        sbom: '${{ runner.temp }}/sbom/worker.spdx.json',
        push: false,
      },
    ]);
  });
});

describe('the release workflow', () => {
  const steps = release.jobs.release.steps;
  const run = steps[at(steps, 'Verify and name the images')]?.run ?? '';

  it('may read attestations', () => {
    expect(release.permissions.attestations).toBe('read');
  });

  it('names a version only from a digest Deploy signed on main, built from this commit', () => {
    const verify = run.indexOf('gh attestation verify "oci://$REGISTRY/$image@$digest"');
    const label = run.indexOf('[ "$revision" = "$GITHUB_SHA" ]');
    const name = run.indexOf('-t "$REGISTRY/$image:$GITHUB_REF_NAME" "$REGISTRY/$image@$digest"');
    expect(verify).toBeGreaterThan(-1);
    expect(label).toBeGreaterThan(verify);
    expect(name).toBeGreaterThan(label);
    // The exact signing identity: this repository's deploy.yml, run from main.
    expect(run).toContain('--cert-identity "$SIGNER"');
    expect(run).toContain('--deny-self-hosted-runners');
    // The signed provenance itself must name main and this commit.
    expect(run).toContain('--source-ref refs/heads/main');
    expect(run).toContain('--source-digest "$GITHUB_SHA"');
    expect(run).not.toContain('--signer-workflow');
    expect(steps[at(steps, 'Verify and name the images')]?.env?.SIGNER).toBe(
      'https://github.com/${{ github.repository }}/.github/workflows/deploy.yml@refs/heads/main',
    );
    expect(run).toContain('org.opencontainers.image.revision');
    // Never from the sha tag, which can be pushed over.
    expect(run).not.toMatch(/imagetools create[^\n]*\n[^\n]*:\$sha"/);
  });

  it('verifies and resolves both images before naming either', () => {
    const loops = [...run.matchAll(/for image in echoandaura-web echoandaura-worker; do/g)];
    expect(loops).toHaveLength(2);
    const naming = loops[1]!.index;
    expect(run.lastIndexOf('gh attestation verify')).toBeLessThan(naming);
    expect(run.lastIndexOf('[ "$revision" = "$GITHUB_SHA" ]')).toBeLessThan(naming);
    expect(run.indexOf('imagetools create')).toBeGreaterThan(naming);
    expect(run).toMatch(/\[\[ "\$digest" =~ \^sha256:\[0-9a-f\]\{64\}\$ \]\] \\\n\s+\|\| \{/);
  });

  it('records the digests in the Release', () => {
    expect(run).toContain("echo '## Images'");
    // The command the notes publish is as strict as the one used here.
    expect(run).toContain('echo "  --cert-identity $SIGNER --deny-self-hosted-runners"');
    expect(run).not.toMatch(/gh attestation verify oci:\/\/<image> --repo [^\n]*`\.'/);
    expect(run).toContain('echo "- \\`$REGISTRY/$image@$digest\\`" >> "$NOTES"');
    expect(at(steps, 'Verify and name the images')).toBeLessThan(at(steps, 'GitHub Release'));
  });
});
