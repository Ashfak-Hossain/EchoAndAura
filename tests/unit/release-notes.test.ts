import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';
import { releaseNotes } from '../../.github/scripts/release-notes.mjs';

const changelog = [
  '# Changelog',
  '',
  '## [Unreleased]',
  '',
  '- Not out yet.',
  '',
  '## [1.1.0] - 2026-11-02',
  '',
  '### Buyers',
  '',
  '- A waitlist.',
  '',
  '## [1.0.0] - 2026-10-14',
  '',
  '- The first release.',
  '',
  '[1.1.0]: https://example.test/compare/v1.0.0...v1.1.0',
  '[1.0.0]: https://example.test/releases/tag/v1.0.0',
  '',
].join('\n');

// ADR-041: a release's notes open with its CHANGELOG.md section.
describe('release notes', () => {
  it("takes the tag's section, without its heading or the next one", () => {
    expect(releaseNotes({ tag: 'v1.1.0', changelog, packageVersion: '1.1.0' })).toBe(
      '### Buyers\n\n- A waitlist.\n',
    );
  });

  it('stops the last section at the link definitions', () => {
    expect(releaseNotes({ tag: 'v1.0.0', changelog, packageVersion: '1.0.0' })).toBe(
      '- The first release.\n',
    );
  });

  it('refuses a version with no section, an undated one or an empty one', () => {
    expect(() => releaseNotes({ tag: 'v1.2.0', changelog, packageVersion: '1.2.0' })).toThrow(
      'no "## [1.2.0] - YYYY-MM-DD" section',
    );
    const undated = changelog.replace('## [1.0.0] - 2026-10-14', '## [1.0.0]');
    expect(() =>
      releaseNotes({ tag: 'v1.0.0', changelog: undated, packageVersion: '1.0.0' }),
    ).toThrow('no "## [1.0.0]');
    const empty = changelog.replace('- The first release.', '');
    expect(() =>
      releaseNotes({ tag: 'v1.0.0', changelog: empty, packageVersion: '1.0.0' }),
    ).toThrow('is empty');
  });

  it('refuses a tag that package.json does not carry, or that is not vX.Y.Z', () => {
    expect(() => releaseNotes({ tag: 'v1.0.0', changelog, packageVersion: '0.1.0' })).toThrow(
      'package.json is version 0.1.0, but the tag is v1.0.0',
    );
    expect(() => releaseNotes({ tag: '1.0.0', changelog, packageVersion: '1.0.0' })).toThrow(
      'not a vX.Y.Z tag',
    );
  });

  it("matches this repository's own version and changelog", () => {
    const version = (JSON.parse(readFileSync('package.json', 'utf8')) as { version: string })
      .version;
    const notes = releaseNotes({
      tag: `v${version}`,
      changelog: readFileSync('CHANGELOG.md', 'utf8'),
      packageVersion: version,
    });
    expect(notes.length).toBeGreaterThan(0);
  });
});

interface Step {
  name?: string;
  run?: string;
}

describe('the release workflow', () => {
  const steps = (
    parse(readFileSync('.github/workflows/release.yml', 'utf8')) as {
      jobs: { release: { steps: Step[] } };
    }
  ).jobs.release.steps;
  const at = (name: string) => steps.findIndex((step) => step.name === name);

  it('checks the notes before naming any image, then publishes them', () => {
    expect(at('Release notes')).toBeGreaterThan(-1);
    expect(at('Release notes')).toBeLessThan(at('Name the images with the version'));
    expect(steps[at('Release notes')]?.run).toContain('release-notes.mjs "$GITHUB_REF_NAME"');
    const publish = steps[at('GitHub Release')]?.run ?? '';
    expect(publish).toContain('--notes-file "$RUNNER_TEMP/release-notes.md"');
    expect(publish).toContain('--generate-notes');
  });
});
