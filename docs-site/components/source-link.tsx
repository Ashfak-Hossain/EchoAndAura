import { statSync } from 'node:fs';
import { resolve, sep } from 'node:path';
import type { ReactNode } from 'react';

const repository = 'https://github.com/Ashfak-Hossain/EchoAndAura';
const root = resolve(process.cwd(), '..');

export function SourceLink({ path, children }: { path: string; children: ReactNode }) {
  const file = resolve(root, path);
  if (!/^(src\/|tests\/|docs\/decisions\/)/.test(path) || !file.startsWith(root + sep)) {
    throw new Error(`Source link is outside the published source categories: ${path}`);
  }
  if (!statSync(file).isFile()) throw new Error(`Source link is not a file: ${path}`);
  const revision = process.env.DOCS_SOURCE_REVISION;
  if (!revision || !/^[a-f0-9]{40}$/.test(revision))
    throw new Error('Missing docs source revision');
  return <a href={`${repository}/blob/${revision}/${path}`}>{children}</a>;
}
