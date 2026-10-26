/**
 * `pnpm backup:drill` — Phase 9.3's restore drill (ADR-088). Run monthly and
 * before each event (RUNBOOK → Restore drill). The owner runs it; Claude
 * never does (ADR-072): the script refuses a Claude Code session itself, and
 * .claude/settings.json and guard-bash.sh refuse the usual commands.
 *
 * Finds the newest off-site backup in S3, streams it through ssh into
 * `ops/db/restore-drill.sh` on the server, which restores it into a
 * throwaway Postgres and compares it with the live database. The dump is
 * never written to a file on the laptop or the server. Prints one ✓/✗ row
 * per check and the line for the RUNBOOK's drill log. Exits 1 on any ✗.
 *
 *   pnpm backup:drill                  production (aws login --profile echoandaura)
 *   pnpm backup:drill-lab              lab: a fresh dump of the compose Postgres
 *   pnpm backup:drill-lab --file x.gz  lab: that dump instead
 */
import { type ChildProcess, spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createReadStream, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createGzip } from 'node:zlib';

/** Off-site backup copy (AWS.md § S3 off-site backups, ADR-051). */
export const OFFSITE_BUCKET = 'echoandaura-offsite-backups';
export const OFFSITE_PREFIX = 'echoandaura-db-ljctqy/postgres/';
/** Dokploy's object names, a UTC timestamp. The name reaches the terminal
 * and the public log, and whoever holds the Dokploy key chooses it. */
export const BACKUP_KEY = /^echoandaura-db-ljctqy\/postgres\/[0-9A-Za-z._-]+\.sql\.gz$/;
/** The 03:30 Dhaka schedule plus slack: older means the schedule stopped. */
export const MAX_AGE_HOURS = 26;
const SERVER = 'echoandaura';
/** Keepalives: the laptop gives up on a dead connection within a minute.
 * The server's side is the script's `timeout 600`. */
const SSH = ['-o', 'BatchMode=yes', '-o', 'ServerAliveInterval=15', '-o', 'ServerAliveCountMax=4'];
const PROD = { container: 'echoandaura-db-ljctqy', owner: 'echoandaura', db: 'echoandaura' };
/** The repository, wherever the command is run from. */
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
/** What the server half needs beside it, copied to a temp folder there. */
const SERVER_FILES = ['restore-drill.sh', 'app-role.sql', 'mask-errors.awk'] as const;
/** What production runs, and the code that sends it: committed only. */
const REVIEWED = ['ops/db', 'scripts/restore-drill.ts', 'package.json'];
/** The tables the app never deletes from; the script counts them. */
export const APPEND_ONLY_COUNTS = ['orders', 'order_events', 'tickets'] as const;

export type Backup = { key: string; lastModified: Date; size: number };
/** `exit` is the server script's exit code. */
export type Report = {
  values: Record<string, string>;
  errors: string[];
  duplicates: string[];
  exit: number | null;
};
export type Result = { name: string; ok: boolean | null; detail: string };

const pass = (name: string, detail: string): Result => ({ name, ok: true, detail });
const fail = (name: string, detail: string): Result => ({ name, ok: false, detail });
const skip = (name: string, detail: string): Result => ({ name, ok: null, detail });

/** Why this process may not run the production drill, or null. It is the
 * owner's (ADR-072): not from a Claude Code session, whose shell sets
 * CLAUDECODE, and not without a person at the terminal. This covers every
 * way of starting it, which the command-line rules can't. */
export function notTheOwner(
  env: Record<string, string | undefined>,
  interactive: boolean,
): string | null {
  if (env.CLAUDECODE) {
    return 'the production drill is the owner’s; Claude Code runs `pnpm backup:drill-lab` (ADR-088)';
  }
  if (!interactive) {
    return 'the production drill needs a person at a terminal: run `pnpm backup:drill` in your own (ADR-088)';
  }
  return null;
}

/** The newest object under the prefix, from `s3api list-objects-v2` JSON.
 * A newest object that isn't named like a backup is an error: an older
 * backup is never used in its place. */
export function newestBackup(listing: unknown): Backup | null {
  const contents = (listing as { Contents?: unknown } | null)?.Contents;
  if (!Array.isArray(contents)) return null;
  let newest: Backup | null = null;
  for (const item of contents as { Key?: unknown; LastModified?: unknown; Size?: unknown }[]) {
    const lastModified = new Date(String(item.LastModified));
    if (typeof item.Key !== 'string' || Number.isNaN(lastModified.getTime())) continue;
    if (!newest || lastModified > newest.lastModified) {
      newest = { key: item.Key, lastModified, size: Number(item.Size) };
    }
  }
  if (newest && !BACKUP_KEY.test(newest.key)) {
    throw new Error(`the newest object is not named like a backup: ${JSON.stringify(newest.key)}`);
  }
  return newest;
}

/** Drops control and format characters (bidi overrides among them), but
 * not newlines or tabs: the server's messages reach the owner's terminal,
 * and some come from the backup. */
export const clean = (text: string) => text.replace(/(?![\n\t])[\p{Cc}\p{Cf}]/gu, '');

/** The script's stdout: `key=value` lines; only `restore_error` may repeat.
 * A repeated key means a value printed lines of its own: `duplicates`. */
export function parseReport(stdout: string, exit: number | null): Report {
  const report: Report = { values: {}, errors: [], duplicates: [], exit };
  for (const line of stdout.split('\n')) {
    const at = line.indexOf('=');
    if (at <= 0) continue;
    const key = line.slice(0, at);
    const value = line.slice(at + 1).replace(/[\p{Cc}\p{Cf}]/gu, '');
    if (key === 'restore_error') report.errors.push(value);
    else if (Object.hasOwn(report.values, key)) report.duplicates.push(key);
    else report.values[key] = value;
  }
  return report;
}

/** Why a run can't be judged at all, or null. `source` is the exit code of
 * what fed the dump (aws or pg_dump), `input` an error reading it. */
export function runError(
  report: Report,
  run: { source?: number | null; input?: Error } = {},
): string | null {
  if (run.input) return `reading the backup failed: ${run.input.message}`;
  if (report.duplicates.length) {
    return `the drill printed ${[...new Set(report.duplicates)].join(', ')} more than once: the backup may be crafted to fake a pass`;
  }
  if (report.exit !== 0 && report.values.restore === undefined) {
    return `the drill script stopped (exit ${report.exit}) before restoring; see the messages above`;
  }
  // A failed restore stops reading, which ends the source early too: then the
  // Restores row has the real reason, so only a lone source failure is one.
  if (run.source !== undefined && run.source !== 0 && report.values.restore === 'ok') {
    return 'the backup stream failed, yet the restore passed: run again';
  }
  return null;
}

const COUNT = /^\d+$/;
const MIGRATIONS = /^\d+ \d+$/;
const MD5 = /^[0-9a-f]{32}$/;

/** The backup's last audit time, from the script's microseconds. */
function cutoffText(us: string | undefined): string {
  if (us === undefined || !COUNT.test(us)) return '?';
  if (us === '0') return 'the start (no audit rows)';
  return new Date(Math.floor(Number(us) / 1000)).toISOString();
}

/** Turns the script's report into the checks. `backup` is null in lab mode;
 * `bytes` is what was streamed to the server. A value that isn't the shape
 * its query returns fails: a query that failed on both sides prints two
 * empty values, which would otherwise match. */
export function evaluate(
  report: Report,
  backup: Backup | null,
  bytes: number,
  now: Date,
): Result[] {
  const v = report.values;
  const results: Result[] = [];

  if (backup) {
    const hours = (now.getTime() - backup.lastModified.getTime()) / 3_600_000;
    results.push(
      hours <= MAX_AGE_HOURS
        ? pass('Fresh', `${hours.toFixed(1)} h old`)
        : fail('Fresh', `${hours.toFixed(1)} h old: the 03:30 S3 schedule has stopped`),
    );
  }

  if (v.restore !== 'ok') {
    const why = report.errors.length
      ? report.errors.join(' | ')
      : v.restore === 'failed'
        ? 'pg_restore gave no error: the stream ended early (see the messages above)'
        : 'the drill stopped before restoring (see the messages above)';
    const oom =
      Number(v.oom_kills) > 0 || v.oom_killed === 'true'
        ? ' (the throwaway ran out of memory)'
        : '';
    results.push(fail('Restores', why + oom));
    return results;
  }
  // Judged only after a restore that read to the end: a failed one stops
  // reading, so the download is short then too.
  if (backup) {
    results.push(
      bytes === backup.size
        ? pass('Download', `${bytes} bytes, all of it`)
        : fail('Download', `${bytes} of ${backup.size} bytes streamed`),
    );
  }
  results.push(
    pass('Restores', `${v.restore_seconds ?? '?'} s, Postgres ${v.server_version ?? '?'}`),
  );

  // A deploy between the backup and the drill can add a migration (and add
  // or drop a table) on live. That's not a broken backup, but the structure
  // can't be compared until the next backup has it.
  const migrationsRead =
    MIGRATIONS.test(v.migrations_backup ?? '') && MIGRATIONS.test(v.migrations_live ?? '');
  const migBackup = Number(v.migrations_backup?.split(' ')[0]);
  const migLive = Number(v.migrations_live?.split(' ')[0]);
  const liveAhead = migrationsRead && migLive > migBackup;

  const tablesBackup = (v.tables_backup ?? '').split(',').filter(Boolean);
  const tablesLive = (v.tables_live ?? '').split(',').filter(Boolean);
  const missing = tablesLive.filter((t) => !tablesBackup.includes(t));
  const extra = tablesBackup.filter((t) => !tablesLive.includes(t));
  const diff = [
    missing.length && `missing ${missing.join(', ')}`,
    extra.length && `extra ${extra.join(', ')}`,
  ]
    .filter(Boolean)
    .join('; ');
  if (!tablesLive.length) {
    results.push(fail('Tables', 'live listed no tables'));
  } else if (!diff) {
    results.push(pass('Tables', `${tablesLive.length}, the same as live`));
  } else if (liveAhead) {
    results.push(skip('Tables', `${diff}: live was deployed after this backup`));
  } else {
    results.push(fail('Tables', diff));
  }

  if (!migrationsRead) {
    results.push(fail('Migrations', 'the migration journal could not be read on both sides'));
  } else if (v.migrations_backup === v.migrations_live) {
    results.push(pass('Migrations', `${migBackup}, the same as live`));
  } else if (liveAhead) {
    results.push(
      skip('Migrations', `live has ${migLive - migBackup} newer: deployed after this backup`),
    );
  } else {
    results.push(fail('Migrations', `backup ${v.migrations_backup}, live ${v.migrations_live}`));
  }

  if (liveAhead) {
    results.push(skip('Schema', 'compared only at the same migration; run again tomorrow'));
  } else {
    results.push(
      MD5.test(v.schema_backup ?? '') && v.schema_backup === v.schema_live
        ? pass(
            'Schema',
            `columns, constraints, indexes, enums match (${v.schema_backup.slice(0, 12)})`,
          )
        : fail('Schema', 'a column, constraint, index or enum differs from live'),
    );
  }

  const cutoff = cutoffText(v.cutoff_us);
  for (const table of APPEND_ONLY_COUNTS) {
    const inBackup = v[`rows_${table}_backup`];
    const inLive = v[`rows_${table}_live`];
    const name = `Rows: ${table}`;
    results.push(
      inBackup !== undefined && COUNT.test(inBackup) && inBackup === inLive
        ? pass(name, `${inBackup} up to ${cutoff}, the same as live`)
        : fail(name, `backup ${inBackup ?? '?'}, live ${inLive ?? '?'} up to ${cutoff}`),
    );
  }

  // The counts above only reach the backup's own last audit row. An old file
  // uploaded again would pass them; this is what catches it.
  results.push(
    v.tail_live === '0'
      ? pass('Up to date', `live has no audit row between ${cutoff} and the upload`)
      : fail(
          'Up to date',
          `live has ${v.tail_live ?? '?'} audit rows after ${cutoff} that the backup should have: an old file?`,
        ),
  );

  results.push(
    /^ok \d+$/.test(v.grants ?? '')
      ? pass('App role grants', `app-role.sql applied; the app reads ${v.grants?.slice(3)} orders`)
      : fail('App role grants', 'app-role.sql did not give the app its rights on the copy'),
  );
  const writable = [
    v.audit_writable_backup !== '0' && `copy ${v.audit_writable_backup ?? '?'}`,
    v.audit_writable_live !== '0' && `live ${v.audit_writable_live ?? '?'}`,
  ].filter(Boolean);
  results.push(
    writable.length
      ? fail(
          'Audit append-only',
          `the app role can still change an audit table: ${writable.join(', ')}`,
        )
      : pass(
          'Audit append-only',
          'the app role cannot change order_events, door_scans or door_decisions, here or live',
        ),
  );

  // Both: `done=ok` printed last, and an exit of 0 after it.
  results.push(
    v.done === 'ok' && report.exit === 0
      ? pass('Completed', 'the server script ran to the end')
      : fail(
          'Completed',
          `the server script stopped part-way (exit ${report.exit}; see the messages above)`,
        ),
  );
  return results;
}

/** One row for RUNBOOK → Restore drill → Drill log. No counts or sizes: the
 * log is public, and either, month by month, would publish sales. A run
 * with a skipped check is `–`, not ✓: something went unchecked. */
export function logRow(
  results: Result[],
  report: Report,
  backup: Backup | null,
  now: Date,
): string {
  const failed = results.filter((r) => r.ok === false).map((r) => r.name);
  const skipped = results.filter((r) => r.ok === null).map((r) => r.name);
  const outcome = failed.length
    ? `✗ ${failed.join(', ')}`
    : skipped.length
      ? `– ${skipped.join(', ')}`
      : '✓';
  // BACKUP_KEY admits no backtick or pipe, so the name can't break the row.
  const source = backup ? `S3 \`${backup.key.slice(OFFSITE_PREFIX.length)}\`` : 'lab';
  const seconds = report.values.restore_seconds ?? '';
  // The date in Dhaka: a 03:30 drill is still "yesterday" in UTC.
  const date = now.toLocaleDateString('en-CA', { timeZone: 'Asia/Dhaka' });
  return `| ${date} | ${source} | ${COUNT.test(seconds) ? seconds : '?'} s | ${outcome} |`;
}

/** The lab's flags. Anything else is refused, so a typo can't fall through
 * to a production run. */
export function parseArgs(args: string[]): { local: boolean; file?: string } {
  const out: { local: boolean; file?: string } = { local: false };
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--local') out.local = true;
    else if (args[i] === '--file' && args[i + 1] && !args[i + 1]?.startsWith('--')) {
      out.file = args[++i];
    } else throw new Error(`unknown or incomplete argument: ${args[i]}`);
  }
  if (out.file && !out.local) throw new Error('--file is for the lab: add --local');
  return out;
}

type Exit = { code: number | null; stdout: string; input?: Error };
/** A source, then the transforms it goes through. */
type Input = [NodeJS.ReadableStream, ...NodeJS.ReadWriteStream[]];

/** Passes a child's stderr on to ours, through `clean`. */
function relay(child: ChildProcess) {
  child.stderr
    ?.setEncoding('utf8')
    .on('data', (chunk: string) => process.stderr.write(clean(chunk)));
}

/** Runs a command; `input` (a source and its transforms) goes to its stdin,
 * its stderr to ours. An error reading the input comes back as `input`. */
function run(cmd: string, args: string[], input?: Input, env?: NodeJS.ProcessEnv): Promise<Exit> {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { stdio: 'pipe', env: env ?? process.env });
    relay(child);
    let stdout = '';
    let inputError: Error | undefined;
    const fed = input
      ? pipeline([...input, child.stdin] as const).catch((error: unknown) => {
          // The far end may stop reading early (a failed restore): its exit
          // code and report say why, so a broken pipe is not the error to show.
          const code = (error as NodeJS.ErrnoException).code;
          if (code === 'EPIPE' || code === 'ERR_STREAM_PREMATURE_CLOSE') return;
          inputError = error instanceof Error ? error : new Error(String(error));
        })
      : Promise.resolve(child.stdin.end());
    child.stdout.setEncoding('utf8').on('data', (chunk: string) => (stdout += chunk));
    child.on('error', reject);
    child.on('close', (code) => {
      // Nothing reads the input any more: stop it rather than wait for its
      // next write to fail.
      (input?.[0] as { destroy?: () => void } | undefined)?.destroy?.();
      void fed.then(() => resolve({ code, stdout, input: inputError }));
    });
  });
}

/** Starts a process that feeds the dump: stdout piped, stderr relayed. */
function source(cmd: string, args: string[], env?: NodeJS.ProcessEnv): ChildProcess {
  const child = spawn(cmd, args, { stdio: ['ignore', 'pipe', 'pipe'], env: env ?? process.env });
  relay(child);
  return child;
}

/** The exit code of a process feeding the dump; -1 if it could not start. */
const exited = (child: ChildProcess) =>
  new Promise<number | null>((resolve) => {
    child.on('error', () => resolve(-1));
    child.on('close', resolve);
  });

/** Once the drill has finished: a source still running after a passed
 * restore is finishing its last bytes, so wait for it; after a failed one,
 * nothing reads it any more, so stop it. */
async function settle(child: ChildProcess, done: Promise<number | null>, report: Report) {
  if (report.values.restore !== 'ok' && child.exitCode === null) child.kill();
  return done;
}

/** Passes bytes through, counting and hashing them. */
function hasher(): Transform & { digest: () => string; bytes: () => number } {
  const hash = createHash('sha256');
  let bytes = 0;
  const t = new Transform({
    transform(chunk: Buffer, _enc, done) {
      hash.update(chunk);
      bytes += chunk.length;
      done(null, chunk);
    },
  });
  return Object.assign(t, { digest: () => hash.digest('hex'), bytes: () => bytes });
}

const serverFile = (file: string) => join(ROOT, 'ops/db', file);
const sha256 = (path: string) => createHash('sha256').update(readFileSync(path)).digest('hex');
const awsEnv = () => ({ ...process.env, AWS_PROFILE: process.env.AWS_PROFILE ?? 'echoandaura' });

type Outcome = { report: Report; sha: string; bytes: number };

async function production(): Promise<Outcome & { backup: Backup }> {
  const refused = notTheOwner(process.env, process.stdin.isTTY === true);
  if (refused) throw new Error(refused);
  // A session's uncommitted edit would otherwise reach production on the
  // owner's next run, and pass the sha256 check below. Only the owner commits.
  const status = await run('git', ['-C', ROOT, 'status', '--porcelain', '--', ...REVIEWED]);
  if (status.code !== 0) throw new Error('git status failed');
  if (status.stdout.trim()) {
    throw new Error(`production runs committed code only; commit or discard:\n${status.stdout}`);
  }

  const listed = await run(
    'aws',
    [
      's3api',
      'list-objects-v2',
      '--bucket',
      OFFSITE_BUCKET,
      '--prefix',
      OFFSITE_PREFIX,
      '--output',
      'json',
    ],
    undefined,
    awsEnv(),
  );
  if (listed.code !== 0)
    throw new Error('aws could not list the bucket: aws login --profile echoandaura');
  const backup = newestBackup(listed.stdout.trim() ? JSON.parse(listed.stdout) : null);
  if (!backup) throw new Error(`no backups under s3://${OFFSITE_BUCKET}/${OFFSITE_PREFIX}`);
  console.error(`newest backup: ${backup.key} (${backup.lastModified.toISOString()})`);

  const made = await run('ssh', [...SSH, SERVER, 'mktemp -d']);
  const dir = made.stdout.trim();
  if (made.code !== 0 || !/^\/tmp\/tmp\.[A-Za-z0-9]+$/.test(dir)) {
    throw new Error(`could not make a temp folder on the server: ${JSON.stringify(dir)}`);
  }
  let download: ChildProcess | undefined;
  try {
    for (const file of SERVER_FILES) {
      const copied = await run(
        'ssh',
        [...SSH, SERVER, `cat > ${dir}/${file}`],
        [createReadStream(serverFile(file))],
      );
      if (copied.code !== 0 || copied.input)
        throw new Error(`could not copy ${file} to the server`);
    }
    // The server runs exactly the committed files (checked above), or nothing.
    const sums = await run('ssh', [
      ...SSH,
      SERVER,
      `cd ${dir} && sha256sum -- ${SERVER_FILES.join(' ')}`,
    ]);
    for (const file of SERVER_FILES) {
      if (!sums.stdout.includes(`${sha256(serverFile(file))}  ${file}`)) {
        throw new Error(`${file} on the server differs from the repository's`);
      }
    }

    download = source('aws', ['s3', 'cp', `s3://${OFFSITE_BUCKET}/${backup.key}`, '-'], awsEnv());
    const downloaded = exited(download);
    const hash = hasher();
    const uploaded = Math.floor(backup.lastModified.getTime() / 1000);
    const drill = await run(
      'ssh',
      [
        ...SSH,
        SERVER,
        `bash ${dir}/restore-drill.sh ${PROD.container} ${PROD.owner} ${PROD.db} ${uploaded}`,
      ],
      [download.stdout as NodeJS.ReadableStream, hash],
    );
    const report = parseReport(drill.stdout, drill.code);
    const fed = await settle(download, downloaded, report);
    const error = runError(report, { source: fed, input: drill.input });
    if (error) throw new Error(error);
    return { report, backup, sha: hash.digest(), bytes: hash.bytes() };
  } finally {
    download?.kill();
    // Never let the clean-up's failure hide the error that got us here.
    await run('ssh', [...SSH, SERVER, `rm -rf -- ${dir}`]).catch(() => undefined);
  }
}

async function local(file: string | undefined): Promise<Outcome> {
  const owner = process.env.POSTGRES_USER;
  const db = process.env.POSTGRES_DB;
  if (!owner || !db) throw new Error('POSTGRES_USER and POSTGRES_DB must be set in .env');
  const hash = hasher();
  const script = [serverFile('restore-drill.sh'), 'echoandaura-postgres', owner, db];
  // The lab has no upload time; now stands in for it, so an older --file
  // fails Up to date, as an old file uploaded again would.
  const now = String(Math.floor(Date.now() / 1000));
  if (file) {
    const drill = await run('bash', [...script, now], [createReadStream(file), hash]);
    const report = parseReport(drill.stdout, drill.code);
    const error = runError(report, { input: drill.input });
    if (error) throw new Error(error);
    return { report, sha: hash.digest(), bytes: hash.bytes() };
  }
  // Dokploy's own command (SERVER.md § 16), against the compose Postgres.
  const pgDump = source('docker', [
    'exec',
    'echoandaura-postgres',
    'pg_dump',
    '-Fc',
    '--no-acl',
    '--no-owner',
    '-U',
    owner,
    '-d',
    db,
  ]);
  const dumped = exited(pgDump);
  const drill = await run(
    'bash',
    [...script, now],
    [pgDump.stdout as NodeJS.ReadableStream, createGzip(), hash],
  );
  const report = parseReport(drill.stdout, drill.code);
  const fed = await settle(pgDump, dumped, report);
  const error = runError(report, { source: fed, input: drill.input });
  if (error) throw new Error(error);
  return { report, sha: hash.digest(), bytes: hash.bytes() };
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const { report, backup, sha, bytes } = args.local
    ? { ...(await local(args.file)), backup: null }
    : await production();
  const now = new Date();
  const results = evaluate(report, backup, bytes, now);

  console.log('');
  const width = Math.max(...results.map((r) => r.name.length));
  for (const r of results) {
    const mark = r.ok === true ? '✓' : r.ok === false ? '✗' : '–';
    console.log(`${mark} ${r.name.padEnd(width)}  ${r.detail}`);
  }
  console.log(`\nimage ${report.values.image ?? '?'}\nsha256 ${sha}`);
  console.log(
    `\nDrill log row (RUNBOOK → Restore drill):\n${logRow(results, report, backup, now)}`,
  );
  process.exitCode = results.some((r) => r.ok === false) ? 1 : 0;
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
