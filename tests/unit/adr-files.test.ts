/**
 * The architecture decision records live one per file in docs/decisions/,
 * with an index (README.md) that lists them by area and draws how they
 * supersede and extend each other. Nothing renders these files from one
 * source, so the copies can drift: a new ADR missing from the index, a
 * gap in the numbering, an older ADR never marked when a later one
 * replaced it, a link to a file that was renamed. These tests catch each
 * of those before merge:
 *
 * - every ADR's front matter has the agreed fields and values;
 * - numbers run 1..N with no gaps or repeats, and match the file names;
 * - supersedes ↔ superseded is reciprocal, and the older ADR links to
 *   the one that replaced it;
 * - the index lists each ADR once, with its area, title, status and date;
 * - the index diagram draws exactly the supersedes and extends links;
 * - every link into or between ADR files resolves.
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join, normalize } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';
import { z } from 'zod';

const DIR = 'docs/decisions';

const AREAS = [
  'Payments and orders',
  'Tickets and email',
  'Gate scanner',
  'Admin',
  'Public site',
  'Localisation',
  'Security and auth',
  'Performance',
  'Infrastructure and deploys',
  'Code structure and tooling',
] as const;

const adrId = z.string().regex(/^ADR-\d{3}$/);
const FrontMatter = z
  .object({
    id: adrId,
    title: z.string().min(1),
    // YAML 1.2 (the `yaml` package's default) keeps an unquoted date a string.
    date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    status: z.enum(['accepted', 'partly-superseded', 'superseded']),
    area: z.enum(AREAS),
    supersedes: z.array(adrId),
    extends: z.array(adrId),
  })
  .strict();

interface Adr extends z.infer<typeof FrontMatter> {
  number: number;
  file: string;
  body: string;
}

const FILE_NAME = /^(\d{3})-[a-z0-9]+(?:-[a-z0-9]+)*\.md$/;
const files = readdirSync(DIR)
  .filter((f) => /^\d{3}-/.test(f))
  .sort();

/** An ADR, or why its front matter is unusable (reported by its own test). */
function readAdr(file: string): Adr | string {
  const text = readFileSync(join(DIR, file), 'utf8');
  const match = text.match(/^---\n([\s\S]*?)\n---\n\n([\s\S]*)$/);
  if (!match) return `${file}: no front matter (--- fields --- and a blank line)`;
  let data: unknown;
  try {
    data = parse(match[1]);
  } catch (error) {
    return `${file}: front matter is not YAML: ${String(error)}`;
  }
  const result = FrontMatter.safeParse(data);
  if (!result.success) return `${file}: ${z.prettifyError(result.error)}`;
  return { ...result.data, number: Number(file.slice(0, 3)), file, body: match[2] };
}

const read = files.map(readAdr);
const frontMatterErrors = read.filter((r) => typeof r === 'string');
const adrs = read.filter((r) => typeof r !== 'string');
const byId = new Map(adrs.map((a) => [a.id, a]));
const numberOf = (id: string) => Number(id.slice(4));

/** The ADRs that supersede each ADR, from the newer side. */
const supersededBy = new Map<string, string[]>();
for (const adr of adrs) {
  for (const old of adr.supersedes) {
    supersededBy.set(old, [...(supersededBy.get(old) ?? []), adr.id]);
  }
}

/** Relative markdown link targets in a text, without any #anchor. */
function relativeLinks(text: string): string[] {
  return [...text.matchAll(/\]\(([^)\s]+)\)/g)]
    .map((m) => m[1])
    .filter((target) => !/^(?:[a-z]+:|#)/.test(target))
    .map((target) => target.split('#')[0]);
}

describe('ADR files', () => {
  it('every file name is NNN-short-slug.md', () => {
    expect(files.length).toBeGreaterThan(0);
    for (const file of files) expect(file).toMatch(FILE_NAME);
  });

  it('every front matter has the agreed fields and values', () => {
    expect(frontMatterErrors).toEqual([]);
  });

  it('every heading is "# ADR-NNN — title", matching the front matter', () => {
    for (const adr of adrs) {
      expect(adr.body.split('\n')[0], adr.file).toBe(`# ${adr.id} — ${adr.title}`);
    }
  });

  it('numbers are unique, run 1..N without gaps, and match the file names', () => {
    expect(adrs.map((a) => a.id)).toEqual(
      adrs.map((_, i) => `ADR-${String(i + 1).padStart(3, '0')}`),
    );
    for (const adr of adrs) expect(numberOf(adr.id), adr.file).toBe(adr.number);
  });

  it('dates are real days and never go backwards', () => {
    for (const [i, adr] of adrs.entries()) {
      expect(new Date(`${adr.date}T00:00:00Z`).toISOString().slice(0, 10), adr.file).toBe(adr.date);
      if (i > 0) expect(adr.date >= adrs[i - 1].date, adr.file).toBe(true);
    }
  });

  it('supersedes and extends name earlier ADRs, each once', () => {
    for (const adr of adrs) {
      for (const list of [adr.supersedes, adr.extends]) {
        expect(new Set(list).size, adr.file).toBe(list.length);
        for (const target of list) {
          expect(byId.has(target), `${adr.file} → ${target}`).toBe(true);
          expect(numberOf(target), `${adr.file} → ${target}`).toBeLessThan(adr.number);
        }
      }
    }
  });

  it('an ADR is marked superseded exactly when a later ADR supersedes it', () => {
    for (const adr of adrs) {
      expect(adr.status !== 'accepted', adr.file).toBe(supersededBy.has(adr.id));
    }
  });

  it('a superseded ADR links to each ADR that replaced it', () => {
    for (const [old, newer] of supersededBy) {
      const adr = byId.get(old);
      for (const id of newer) {
        const target = byId.get(id)?.file;
        expect(adr?.body, `${old} → ${id}`).toContain(`](${target})`);
      }
    }
  });
});

describe('the ADR index', () => {
  const index = readFileSync(join(DIR, 'README.md'), 'utf8');

  it('lists every ADR once, under its area, with its title, status and date', () => {
    const rows = new Map<string, { area: string | undefined; cells: string[] }>();
    let area: string | undefined;
    for (const line of index.split('\n')) {
      if (line.startsWith('### ')) area = line.slice(4);
      const cells = line.split('|').map((c) => c.trim());
      if (!/^\d{3}$/.test(cells[1] ?? '')) continue;
      const id = `ADR-${cells[1]}`;
      expect(rows.has(id), `${id} listed twice`).toBe(false);
      rows.set(id, { area, cells: cells.slice(2, -1) });
    }
    expect([...rows.keys()].sort()).toEqual(adrs.map((a) => a.id));

    for (const adr of adrs) {
      const row = rows.get(adr.id);
      const replacedBy = (supersededBy.get(adr.id) ?? [])
        .map((id) => `[${id}](${byId.get(id)?.file})`)
        .join(', ');
      const status = {
        accepted: 'Accepted',
        'partly-superseded': `Partly superseded by ${replacedBy}`,
        superseded: `Superseded by ${replacedBy}`,
      }[adr.status];
      expect(row?.area, adr.id).toBe(adr.area);
      expect(row?.cells, adr.id).toEqual([`[${adr.title}](${adr.file})`, status, adr.date]);
    }
  });

  it('has a table for each area, in the agreed order', () => {
    const headings = [...index.matchAll(/^### (.+)$/gm)].map((m) => m[1]);
    expect(headings).toEqual([...AREAS]);
  });

  it('draws exactly the supersedes (solid) and extends (dotted) links', () => {
    const diagram = index.match(/```mermaid\n([\s\S]*?)```/)?.[1] ?? '';
    // An edge line is "aNNN <arrow> aMMM". Arrows are compared as plain
    // strings: any other arrow style fails here rather than going unseen.
    const drawn: Record<string, string[]> = {};
    for (const line of diagram.split('\n')) {
      const [from, arrow, to, ...rest] = line.trim().split(' ');
      if (rest.length > 0 || !/^a\d{3}$/.test(from) || !/^a\d{3}$/.test(to ?? '')) continue;
      (drawn[arrow] ??= []).push(`ADR-${from.slice(1)} → ADR-${to.slice(1)}`);
    }

    const solid = adrs.flatMap((a) => a.supersedes.map((old) => `${old} → ${a.id}`)).sort();
    // A pair that is both superseded and extended (ADR-030 → ADR-034) is drawn once, solid.
    const dotted = adrs
      .flatMap((a) =>
        a.extends.filter((old) => !a.supersedes.includes(old)).map((old) => `${old} → ${a.id}`),
      )
      .sort();

    expect(Object.keys(drawn).sort()).toEqual(['-->', '-.->']);
    expect(drawn['-->'].sort()).toEqual(solid);
    expect(drawn['-.->'].sort()).toEqual(dotted);
  });
});

describe('links to ADRs', () => {
  it('every relative link in docs/decisions resolves', () => {
    for (const file of readdirSync(DIR).filter((f) => f.endsWith('.md'))) {
      for (const target of relativeLinks(readFileSync(join(DIR, file), 'utf8'))) {
        expect(existsSync(join(DIR, target)), `${file} → ${target}`).toBe(true);
      }
    }
  });

  // The rest of the repository's docs: links into docs/decisions/ resolve,
  // and none point at the old single file (it is only a pointer now).
  const docs = [
    ...readdirSync('.').filter((f) => f.endsWith('.md')),
    ...['docs', '.claude', '.github'].flatMap((dir) =>
      readdirSync(dir, { encoding: 'utf8', recursive: true })
        .filter((f) => f.endsWith('.md'))
        .map((f) => join(dir, f)),
    ),
  ].filter((f) => !normalize(f).startsWith(`${DIR}/`));

  it('every link into docs/decisions/ from other docs resolves', () => {
    for (const file of docs) {
      for (const target of relativeLinks(readFileSync(file, 'utf8'))) {
        if (!target.includes('decisions/')) continue;
        expect(existsSync(join(dirname(file), target)), `${file} → ${target}`).toBe(true);
      }
    }
  });

  it('no doc links to the old DECISIONS.md', () => {
    for (const file of docs) {
      const stale = relativeLinks(readFileSync(file, 'utf8')).filter((t) =>
        t.endsWith('DECISIONS.md'),
      );
      expect(stale, file).toEqual([]);
    }
  });
});
