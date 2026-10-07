import { test } from 'node:test';
import assert from 'node:assert/strict';
import { extractSymbol, sourceExcerpt, remarkSourceExcerpts } from '../lib/source-excerpts.ts';

test('extracts a named method and follows edits without fixed line numbers', () => {
  const before = 'const repo = {\n  async reserve() {\n    return true;\n  },\n};';
  const after = '// newly added line\n' + before.replace('return true', 'return false');
  assert.match(extractSymbol(before, 'repo.reserve', 'fixture.ts'), /return true/);
  assert.match(extractSymbol(after, 'repo.reserve', 'fixture.ts'), /return false/);
  assert.doesNotMatch(extractSymbol(after, 'repo.reserve', 'fixture.ts'), /newly added line/);
});

test('missing and ambiguous symbols fail visibly', () => {
  assert.throws(() => extractSymbol('const value = 1;', 'gone', 'fixture.ts'), /found 0/);
  assert.throws(
    () => extractSymbol('function f() {} function outer() { function f() {} }', 'f', 'fixture.ts'),
    /found 2/,
  );
});

test('excerpts cannot read personal notes, env files, or traversal paths', () => {
  for (const path of ['notes/PROGRESS.md', '.env', 'src/../notes/PROGRESS.ts']) {
    assert.throws(() => sourceExcerpt(path, 'anything'), /outside application TypeScript/);
  }
});

test('actual application excerpts and dependency tracking work', () => {
  assert.match(
    sourceExcerpt('src/server/repositories/inventory.repository.ts', 'inventoryRepository.reserve'),
    /return rows.length === 1/,
  );
  assert.match(
    sourceExcerpt('src/server/lib/order-status.ts', 'ORDER_TRANSITIONS'),
    /pending_verification/,
  );
  const dependencies: string[] = [];
  const tree = {
    type: 'root',
    children: [
      { type: 'code', value: '', meta: 'source="src/server/lib/hold.ts#holdLapsed" title="Hold"' },
    ],
  };
  remarkSourceExcerpts()(tree, {
    data: {
      _compiler: {
        addDependency(path: string) {
          dependencies.push(path);
        },
      },
    },
  });
  assert.match(tree.children[0].value, /pending_payment/);
  assert.equal(tree.children[0].meta, 'title="Hold"');
  assert.equal(dependencies.length, 1);
});

test('source fences refuse stale copied bodies and malformed selectors', () => {
  const transform = remarkSourceExcerpts();
  for (const node of [
    { type: 'code', value: 'copied code', meta: 'source="src/server/lib/hold.ts#holdLapsed"' },
    { type: 'code', value: '', meta: 'source="notes/PROGRESS.md"' },
  ])
    assert.throws(
      () => transform({ type: 'root', children: [node] }, { data: {} }),
      /Source fences/,
    );
});

test('Twoslash gets the actual pure module and tracks its source dependency', () => {
  const tree = {
    type: 'root',
    children: [
      {
        type: 'code',
        meta: 'twoslash source-module="src/server/lib/order-rules.ts"',
        value:
          "import { isValidOrderQuantity } from './order-rules';\n// ---cut---\nconst valid = isValidOrderQuantity(2);",
      },
    ],
  };
  const dependencies: string[] = [];
  remarkSourceExcerpts()(tree, {
    data: { _compiler: { addDependency: (path: string) => dependencies.push(path) } },
  });
  assert.match(tree.children[0].value, /@filename: order-rules.ts/);
  assert.match(tree.children[0].value, /Number.isInteger\(quantity\)/);
  assert.match(tree.children[0].value, /@filename: index.ts/);
  assert.equal(tree.children[0].meta, 'twoslash');
  assert.equal(dependencies.length, 1);
  assert.throws(
    () =>
      remarkSourceExcerpts()(
        {
          type: 'root',
          children: [
            {
              type: 'code',
              meta: 'twoslash source-module="notes/PROGRESS.md"',
              value: '// ---cut---',
            },
          ],
        },
        { data: {} },
      ),
    /Source modules/,
  );
});
