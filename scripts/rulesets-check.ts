/**
 * `pnpm rulesets:check` — proves GitHub's live rulesets are exactly the files
 * in ops/github/rulesets/ (ADR-074). Read-only: one `gh api` GET per
 * ruleset. Needs `gh` signed in. Exits 1 on any difference, a ruleset that
 * is live but has no file, or a file that is not live.
 *
 * The owner applies a file with
 *   gh api -X POST repos/Ashfak-Hossain/EchoAndAura/rulesets --input <file>
 * (or -X PUT …/rulesets/<id> to change one); Claude only reads.
 */
import { execFile } from 'node:child_process';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { promisify } from 'node:util';

const exec = promisify(execFile);

const REPO = 'Ashfak-Hossain/EchoAndAura';
export const RULESETS_DIR = 'ops/github/rulesets';

/** The fields a ruleset is created from; the rest (id, dates, links) is GitHub's. */
const FIELDS = ['name', 'target', 'enforcement', 'bypass_actors', 'conditions', 'rules'] as const;

export type Ruleset = Record<string, unknown> & { name: string };

/** Object keys sorted at every level, so two equal rulesets print the same. */
function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((key) => [key, canonical((value as Record<string, unknown>)[key])]),
    );
  }
  return value;
}

/** Only the fields a ruleset is created from, in canonical form. */
export function defining(ruleset: Record<string, unknown>): string {
  return JSON.stringify(canonical(Object.fromEntries(FIELDS.map((f) => [f, ruleset[f]]))));
}

/** Names that appear more than once; matching by name needs them unique. */
function duplicates(rulesets: Ruleset[]): string[] {
  const names = rulesets.map((r) => r.name);
  return [...new Set(names.filter((n, i) => names.indexOf(n) !== i))];
}

/** Every difference between the files and what GitHub holds, by ruleset name. */
export function drift(files: Ruleset[], live: Ruleset[]): string[] {
  // GitHub leaves bypass_actors out for a caller who can't edit the ruleset.
  // Comparing then would report a false "differs", or miss a real bypass.
  const hidden = live.filter((r) => !Array.isArray(r.bypass_actors));
  if (hidden.length > 0) {
    return hidden.map(
      (r) => `"${r.name}": GitHub hid bypass_actors; sign gh in as the repository admin`,
    );
  }
  const twice = [
    ...duplicates(files).map((n) => `"${n}": more than one file has this name`),
    ...duplicates(live).map((n) => `"${n}": more than one ruleset on GitHub has this name`),
  ];
  if (twice.length > 0) return twice;

  const liveByName = new Map(live.map((r) => [r.name, r]));
  const fileNames = new Set(files.map((r) => r.name));
  return [
    ...files.flatMap((file) => {
      const current = liveByName.get(file.name);
      if (current === undefined) return [`"${file.name}": in the repo, not on GitHub`];
      return defining(file) === defining(current)
        ? []
        : [`"${file.name}": differs on GitHub (fields: ${changed(file, current).join(', ')})`];
    }),
    ...live
      .filter((r) => !fileNames.has(r.name))
      .map((r) => `"${r.name}": on GitHub, not in the repo`),
  ];
}

function changed(a: Record<string, unknown>, b: Record<string, unknown>): string[] {
  return FIELDS.filter((f) => JSON.stringify(canonical(a[f])) !== JSON.stringify(canonical(b[f])));
}

export function readRulesetFiles(dir = RULESETS_DIR): Ruleset[] {
  return readdirSync(dir)
    .filter((f) => f.endsWith('.json'))
    .map((f) => JSON.parse(readFileSync(join(dir, f), 'utf8')) as Ruleset);
}

async function gh(path: string, ...flags: string[]): Promise<unknown> {
  const { stdout } = await exec('gh', ['api', ...flags, path]);
  return JSON.parse(stdout);
}

async function main(): Promise<void> {
  // --slurp wraps each page's array in one outer array, so a ruleset on a
  // second page is still checked.
  const pages = (await gh(`repos/${REPO}/rulesets`, '--paginate', '--slurp')) as { id: number }[][];
  const list = pages.flat();
  // The list leaves out rules and bypass actors; each one is read in full.
  const live = (await Promise.all(
    list.map((r) => gh(`repos/${REPO}/rulesets/${r.id}`)),
  )) as Ruleset[];
  const problems = drift(readRulesetFiles(), live);
  if (problems.length === 0) {
    console.log(`✓ ${live.length} rulesets on GitHub match ${RULESETS_DIR}/`);
    return;
  }
  for (const p of problems) console.log(`✗ ${p}`);
  process.exitCode = 1;
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
