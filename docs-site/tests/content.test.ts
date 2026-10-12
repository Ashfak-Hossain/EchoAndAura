import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import assert from 'node:assert/strict';

const root = 'content/docs';
const pages = readdirSync(root, { recursive: true, encoding: 'utf8' })
  .filter((file) => file.endsWith('.mdx'))
  .map((file) => join(root, file));

// In MDX a line that starts with a tag is a block of its own, and Prettier
// then adds a blank line before it, splitting the sentence into two
// paragraphs. Keep an inline link mid-line: break the line before it.
test('no inline source link starts a line', () => {
  const offenders = pages.flatMap((file) =>
    readFileSync(file, 'utf8')
      .split('\n')
      .flatMap((line, i) => (line.startsWith('<SourceLink') ? [`${file}:${i + 1}`] : [])),
  );
  assert.deepEqual(offenders, []);
});
