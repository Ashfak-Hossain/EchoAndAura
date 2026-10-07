import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import ts from 'typescript';

interface MarkdownNode {
  type: string;
  value?: string;
  meta?: string | null;
  children?: MarkdownNode[];
}

function named(node: ts.Node, name: string): boolean {
  if (!('name' in node) || !node.name) return false;
  const identifier = node.name as ts.Node;
  return ts.isIdentifier(identifier) && identifier.text === name;
}

/** A renamed or ambiguous symbol fails the build instead of showing stale lines. */
export function extractSymbol(text: string, selector: string, fileName: string): string {
  const source = ts.createSourceFile(fileName, text, ts.ScriptTarget.Latest, true);
  const [name, member, ...rest] = selector.split('.');
  if (!name || rest.length) throw new Error(`Unsupported source selector: ${selector}`);
  const matches: ts.Node[] = [];
  function visit(node: ts.Node) {
    if (
      (ts.isFunctionDeclaration(node) ||
        ts.isMethodDeclaration(node) ||
        ts.isVariableDeclaration(node)) &&
      named(node, name)
    ) {
      if (member) {
        if (
          ts.isVariableDeclaration(node) &&
          node.initializer &&
          ts.isObjectLiteralExpression(node.initializer)
        ) {
          matches.push(
            ...node.initializer.properties.filter((property) => named(property, member)),
          );
        }
      } else matches.push(ts.isVariableDeclaration(node) ? node.parent.parent : node);
    }
    ts.forEachChild(node, visit);
  }
  visit(source);
  if (matches.length !== 1)
    throw new Error(`${fileName}: expected one ${selector}, found ${matches.length}`);
  const lines = matches[0].getText(source).split('\n');
  const indent = Math.min(
    ...lines
      .slice(1)
      .filter((line) => line.trim())
      .map((line) => line.match(/^ */)?.[0].length ?? 0),
  );
  return [
    lines[0],
    ...lines.slice(1).map((line) => line.slice(Number.isFinite(indent) ? indent : 0)),
  ].join('\n');
}

function applicationSource(path: string): string {
  // Only deliberately selected application TypeScript can become an excerpt.
  if (
    !/^src\/(?:[a-zA-Z0-9_()[\]-]+\/)*[a-zA-Z0-9_.-]+\.ts$/.test(path) ||
    path.split('/').includes('..')
  ) {
    throw new Error(`Source excerpt is outside application TypeScript: ${path}`);
  }
  return readFileSync(resolve(process.cwd(), '..', path), 'utf8');
}

export function sourceExcerpt(path: string, selector: string): string {
  return extractSymbol(applicationSource(path), selector, path);
}

export function remarkSourceExcerpts() {
  return (tree: MarkdownNode, file: { data: Record<string, unknown> }) => {
    function visit(node: MarkdownNode) {
      if (node.type === 'code' && node.meta?.includes('source-module=')) {
        const match = node.meta.match(/source-module="(src\/[^"#]+\.ts)"/);
        if (!match || !node.meta.includes('twoslash') || !node.value?.includes('// ---cut---'))
          throw new Error('Source modules require a Twoslash sample with a cut marker');
        const name = match[1].split('/').at(-1);
        // The virtual module is refreshed with each MDX compilation, not cached
        // in the config. Twoslash checks it without importing app runtime code.
        node.value = `// @filename: ${name}\n${applicationSource(match[1])}\n// @filename: index.ts\n${node.value}`;
        node.meta = node.meta.replace(match[0], '').trim();
        const compiler = file.data._compiler as { addDependency(path: string): void } | undefined;
        compiler?.addDependency(resolve(process.cwd(), '..', match[1]));
      }
      if (node.type === 'code' && node.meta?.includes('source=')) {
        const match = node.meta.match(/source="(src\/[^"#]+)#([a-zA-Z0-9_.]+)"/);
        if (!match || node.value?.trim())
          throw new Error('Source fences must be empty and name a file#symbol');
        node.value = sourceExcerpt(match[1], match[2]);
        node.meta = node.meta.replace(match[0], '').trim();
        // Same dependency hook used by the installed MDX include plugin:
        // source edits invalidate both the build cache and development watch.
        const compiler = file.data._compiler as { addDependency(path: string): void } | undefined;
        compiler?.addDependency(resolve(process.cwd(), '..', match[1]));
      }
      node.children?.forEach(visit);
    }
    visit(tree);
  };
}
