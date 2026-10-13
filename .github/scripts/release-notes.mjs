import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// ADR-041: a version tag publishes a GitHub Release. Its notes open with the
// tag's CHANGELOG.md section, written for the organizer; the PR list GitHub
// generates is appended after it. The release stops here, before any image is
// named, when the section is missing or package.json names another version:
// a tag cannot go out with notes nobody wrote.

const tagPattern = /^v(\d+\.\d+\.\d+)$/;
const linkDefinition = /^\[[^\]]+\]:\s/;

/**
 * The body of `## [X.Y.Z] - YYYY-MM-DD` in the changelog, for tag `vX.Y.Z`,
 * without the heading and without the link definitions at the file's end.
 * Throws when the tag, the version or the section is wrong.
 */
export function releaseNotes({ tag, changelog, packageVersion }) {
  const match = tagPattern.exec(tag);
  if (!match) throw new Error(`"${tag}" is not a vX.Y.Z tag`);
  const version = match[1];
  if (packageVersion !== version) {
    throw new Error(`package.json is version ${packageVersion}, but the tag is ${tag}`);
  }

  const lines = changelog.split('\n');
  const heading = new RegExp(`^## \\[${version.replaceAll('.', '\\.')}\\] - \\d{4}-\\d{2}-\\d{2}$`);
  const start = lines.findIndex((line) => heading.test(line));
  if (start === -1) {
    throw new Error(`CHANGELOG.md has no "## [${version}] - YYYY-MM-DD" section`);
  }
  const rest = lines.slice(start + 1);
  const end = rest.findIndex((line) => line.startsWith('## ') || linkDefinition.test(line));
  const body = (end === -1 ? rest : rest.slice(0, end)).join('\n').trim();
  if (!body) throw new Error(`The CHANGELOG.md section for ${version} is empty`);
  return `${body}\n`;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const notes = releaseNotes({
      tag: process.argv[2] ?? '',
      changelog: readFileSync('CHANGELOG.md', 'utf8'),
      packageVersion: JSON.parse(readFileSync('package.json', 'utf8')).version,
    });
    process.stdout.write(notes);
  } catch (err) {
    console.error(`::error::${err instanceof Error ? err.message : String(err)}`);
    process.exitCode = 1;
  }
}
