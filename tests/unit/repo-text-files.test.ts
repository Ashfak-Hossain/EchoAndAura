import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

// Every text file is LF with 2-space indents, the same on every OS
// (.editorconfig for editors, .gitattributes for git). A CRLF shell script
// fails inside the Linux images, and a binary git converts is corrupted.
// Needs a git checkout (CI has one): git itself answers what it would do.

const editorconfig = readFileSync('.editorconfig', 'utf8');
const gitattributes = readFileSync('.gitattributes', 'utf8');

const git = (...args: string[]) => execFileSync('git', args, { encoding: 'utf8' });

/** The body of one `[glob]` section of .editorconfig, up to the next one. */
function section(glob: string): string {
  const start = editorconfig.indexOf(`\n[${glob}]\n`);
  if (start === -1) throw new Error(`.editorconfig has no [${glob}] section`);
  const body = editorconfig.slice(start + glob.length + 4);
  return body.split(/^\[/m)[0] ?? '';
}

const eolLines = git('ls-files', '--eol').split('\n').filter(Boolean);

describe('.editorconfig', () => {
  it('is the root, with LF, utf-8 and 2 spaces for every file', () => {
    expect(editorconfig).toMatch(/^root = true$/m);
    for (const rule of [
      'charset = utf-8',
      'end_of_line = lf',
      'indent_style = space',
      'indent_size = 2',
      'insert_final_newline = true',
      'trim_trailing_whitespace = true',
    ]) {
      expect(section('*')).toMatch(new RegExp(`^${rule}$`, 'm'));
    }
  });

  it('leaves drizzle-kit output alone, so saving a migration changes nothing', () => {
    for (const key of [
      'indent_style',
      'indent_size',
      'trim_trailing_whitespace',
      'insert_final_newline',
    ]) {
      expect(section('drizzle/**')).toMatch(new RegExp(`^${key} = unset$`, 'm'));
    }
  });
});

describe('the tracked files', () => {
  it('are stored with LF: text=auto eol=lf for everything', () => {
    expect(gitattributes).toMatch(/^\* +text=auto +eol=lf$/m);
    const crlf = eolLines.filter((line) => /^i\/(crlf|mixed)\b/.test(line));
    expect(crlf).toEqual([]);
  });

  it('that git sees as binary are marked binary, so it never converts them', () => {
    const binaries = eolLines
      .filter((line) => line.startsWith('i/-text'))
      .map((line) => line.split('\t')[1] ?? '');
    expect(binaries.length).toBeGreaterThan(0);
    const unmarked = git('check-attr', 'binary', '--', ...binaries)
      .split('\n')
      .filter((line) => line !== '' && !line.endsWith(': binary: set'));
    expect(unmarked).toEqual([]);
  });
});
