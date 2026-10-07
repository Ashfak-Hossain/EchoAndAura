import { readFile, readdir, stat } from 'node:fs/promises';
import { resolve, join, sep } from 'node:path';
import { parse } from 'parse5';

const root = resolve('out');
async function files(dir) {
  const entries = await readdir(dir, { withFileTypes: true });
  return (
    await Promise.all(
      entries.map((entry) =>
        entry.isDirectory() ? files(join(dir, entry.name)) : join(dir, entry.name),
      ),
    )
  ).flat();
}
const html = (await files(root)).filter((file) => file.endsWith('.html'));
const pages = new Map();
for (const file of html) {
  const ids = new Set();
  const links = [];
  function visit(node) {
    const attrs = new Map(node.attrs?.map((attr) => [attr.name, attr.value]));
    if (attrs.has('id')) ids.add(attrs.get('id'));
    if (attrs.has('href')) links.push(attrs.get('href'));
    if (attrs.has('src')) links.push(attrs.get('src'));
    for (const child of node.childNodes ?? []) visit(child);
  }
  visit(parse(await readFile(file, 'utf8')));
  pages.set(file, { ids, links });
}
let checked = 0;
for (const [file, { links }] of pages) {
  const relative = file.slice(root.length).replaceAll(sep, '/');
  const pathname = relative.endsWith('/index.html') ? relative.slice(0, -10) : relative;
  for (const link of links) {
    const url = new URL(link, `https://docs.echoandaura.com${pathname}`);
    if (url.origin !== 'https://docs.echoandaura.com') continue;
    const target = resolve(root, '.' + decodeURIComponent(url.pathname));
    if (!target.startsWith(root + sep) && target !== root)
      throw new Error(`Outside export: ${link}`);
    const info = await stat(target).catch(() => undefined);
    const actual = info?.isDirectory() ? join(target, 'index.html') : target;
    if (!(await stat(actual).catch(() => undefined))?.isFile())
      throw new Error(`${file}: missing ${link}`);
    if (
      url.hash &&
      pages.has(actual) &&
      !pages.get(actual).ids.has(decodeURIComponent(url.hash.slice(1)))
    ) {
      throw new Error(`${file}: missing anchor ${link}`);
    }
    checked++;
  }
}
// A top-level 404 keeps Cloudflare Pages from treating the export as an SPA.
await stat(join(root, '404.html'));
await stat(join(root, 'api/search'));
console.log(`Export checked: ${html.length} HTML files, ${checked} internal links/assets.`);
