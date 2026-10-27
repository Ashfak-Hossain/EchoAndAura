/**
 * ADR-088: the restore drill proves the newest off-site backup restores and
 * matches production. Two halves are tested here:
 *
 * - the laptop's judgement (`scripts/restore-drill.ts`): each check passes
 *   on a good report and fails on the case it exists for;
 * - the server script's promises (`ops/db/restore-drill.sh`), which hold
 *   buyer data: no network, a tmpfs, removed on every exit, read-only on
 *   live, and no row ever printed. It runs here against a fake `docker`;
 *   its behaviour against a real Postgres is the lab run in RUNBOOK →
 *   Restore drill.
 */
import { execFileSync, spawn, spawnSync } from 'node:child_process';
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { gzipSync } from 'node:zlib';
import { afterAll, describe, expect, it } from 'vitest';
import {
  APPEND_ONLY_COUNTS,
  type Backup,
  BACKUP_KEY,
  clean,
  evaluate,
  logRow,
  MAX_AGE_HOURS,
  newestBackup,
  notTheOwner,
  OFFSITE_PREFIX,
  parseArgs,
  parseReport,
  type Report,
  runError,
} from '../../scripts/restore-drill';

const script = 'ops/db/restore-drill.sh';
const now = new Date('2026-10-27T04:00:00Z');
const backup: Backup = {
  key: `${OFFSITE_PREFIX}2026-10-26T21-30-00-123Z.sql.gz`,
  lastModified: new Date('2026-10-26T21:30:05Z'),
  size: 4096,
};

/** What the server script prints after a good restore. The counts are
 * made up. */
const good = `image=sha256:abc
restore=ok
restore_seconds=2
server_version=17.11
tables_backup=orders,order_events,tickets
tables_live=orders,order_events,tickets
migrations_backup=27 1760000000000
migrations_live=27 1760000000000
schema_backup=4182ba2970ff00000000000000000000
schema_live=4182ba2970ff00000000000000000000
cutoff_us=1793048400000000
rows_orders_backup=10
rows_orders_live=10
rows_order_events_backup=30
rows_order_events_live=30
rows_tickets_backup=12
rows_tickets_live=12
tail_live=0
grants=ok 10
audit_writable_backup=0
audit_writable_live=0
done=ok
`;

const withValues = (changes: Record<string, string>): Report => {
  const r = parseReport(good, 0);
  return { ...r, values: { ...r.values, ...changes } };
};
const byName = (report: Report, b: Backup | null = backup, bytes = backup.size) =>
  Object.fromEntries(evaluate(report, b, bytes, now).map((r) => [r.name, r]));

describe('notTheOwner', () => {
  it('refuses a Claude Code session, and a run with no one at the terminal', () => {
    expect(notTheOwner({ CLAUDECODE: '1' }, true)).toContain('backup:drill-lab');
    expect(notTheOwner({}, false)).toContain('terminal');
    expect(notTheOwner({}, true)).toBeNull();
  });
});

describe('newestBackup', () => {
  it('picks the newest backup', () => {
    const found = newestBackup({
      Contents: [
        { Key: `${OFFSITE_PREFIX}a.sql.gz`, LastModified: '2026-10-25T21:30:00Z', Size: 1 },
        { Key: `${OFFSITE_PREFIX}b.sql.gz`, LastModified: '2026-10-26T21:30:00Z', Size: 2 },
      ],
    });
    expect(found?.key).toBe(`${OFFSITE_PREFIX}b.sql.gz`);
    expect(found?.size).toBe(2);
  });

  it.each([
    ['another kind of file', 'c.txt'],
    ['a backtick and a pipe', 'x`|y.sql.gz'],
    ['an escape sequence', '\u001b]52;c;eA==\u0007.sql.gz'],
  ])('refuses %s as the newest, rather than using an older backup', (_, name) => {
    expect(() =>
      newestBackup({
        Contents: [
          { Key: `${OFFSITE_PREFIX}a.sql.gz`, LastModified: '2026-10-25T21:30:00Z', Size: 1 },
          { Key: `${OFFSITE_PREFIX}${name}`, LastModified: '2026-10-27T00:00:00Z', Size: 3 },
        ],
      }),
    ).toThrow('not named like a backup');
  });

  it('returns null for an empty or missing listing', () => {
    expect(newestBackup(null)).toBeNull();
    expect(newestBackup({})).toBeNull();
    expect(newestBackup({ Contents: [] })).toBeNull();
  });

  it('accepts the names Dokploy writes', () => {
    expect(BACKUP_KEY.test(backup.key)).toBe(true);
    expect(BACKUP_KEY.test(`${OFFSITE_PREFIX}../x.sql.gz`)).toBe(false);
    expect(BACKUP_KEY.test(`other/${backup.key}`)).toBe(false);
  });
});

describe('clean', () => {
  it('drops control and bidi characters, keeping lines and tabs', () => {
    expect(clean('a\u001b[2Jb‮c\n\td')).toBe('a[2Jbc\n\td');
  });
});

describe('parseReport', () => {
  it('splits on the first =, and collects every restore_error', () => {
    const r = parseReport(
      'cutoff=2026-10-26 21:00:00+00\nrestore_error=a\nrestore_error=b=c\nnoise\n',
      0,
    );
    expect(r.values.cutoff).toBe('2026-10-26 21:00:00+00');
    expect(r.errors).toEqual(['a', 'b=c']);
    expect(r.duplicates).toEqual([]);
  });

  it('drops control and format characters, which could drive the terminal', () => {
    expect(parseReport('tables_backup=orders\u001b[2J,‮tickets\n', 0).values.tables_backup).toBe(
      'orders[2J,tickets',
    );
  });

  it('keeps the first of a repeated key and records the repeat', () => {
    const r = parseReport('done=ok\ntail_live=0\ndone=ok\n', 0);
    expect(r.values.done).toBe('ok');
    expect(r.duplicates).toEqual(['done']);
  });
});

describe('evaluate', () => {
  it('passes every check on a good report', () => {
    const results = evaluate(parseReport(good, 0), backup, backup.size, now);
    expect(results.filter((r) => r.ok !== true)).toEqual([]);
    expect(results.map((r) => r.name)).toEqual([
      'Fresh',
      'Download',
      'Restores',
      'Tables',
      'Migrations',
      'Schema',
      ...APPEND_ONLY_COUNTS.map((t) => `Rows: ${t}`),
      'Up to date',
      'App role grants',
      'Audit append-only',
      'Completed',
    ]);
  });

  it('fails a backup older than the schedule allows', () => {
    const old = {
      ...backup,
      lastModified: new Date(now.getTime() - (MAX_AGE_HOURS + 1) * 3_600_000),
    };
    expect(byName(parseReport(good, 0), old).Fresh?.ok).toBe(false);
  });

  it('fails a download that stopped short', () => {
    expect(byName(parseReport(good, 0), backup, backup.size - 1).Download?.ok).toBe(false);
  });

  it('skips Fresh and Download in lab mode', () => {
    const names = evaluate(parseReport(good, 0), null, 0, now).map((r) => r.name);
    expect(names).not.toContain('Fresh');
    expect(names).not.toContain('Download');
  });

  it('stops at a failed restore and shows its errors', () => {
    const report = parseReport(
      'restore=failed\nrestore_error=pg_restore: error: violates check constraint "orders_totals_consistent"\n',
      0,
    );
    const results = evaluate(report, null, 0, now);
    expect(results).toHaveLength(1);
    expect(results[0]).toMatchObject({ name: 'Restores', ok: false });
    expect(results[0]?.detail).toContain('orders_totals_consistent');
  });

  it('does not judge the download of a failed restore, which stops reading', () => {
    const r = byName(parseReport('restore=failed\n', 0), backup, 10);
    expect(r.Download).toBeUndefined();
    expect(r.Restores?.detail).toContain('ended early');
  });

  it('says when the throwaway ran out of memory, from either signal', () => {
    for (const out of ['restore=failed\noom_kills=1\n', 'restore=failed\noom_killed=true\n']) {
      expect(evaluate(parseReport(out, 0), null, 0, now)[0]?.detail).toContain('out of memory');
    }
  });

  it('fails when the script never reached the restore', () => {
    const results = evaluate(parseReport('image=sha256:abc\n', 0), null, 0, now);
    expect(results[0]).toMatchObject({ name: 'Restores', ok: false });
    expect(results[0]?.detail).toContain('before restoring');
  });

  it('names a table missing from the backup', () => {
    const r = byName(withValues({ tables_backup: 'orders,tickets' }));
    expect(r.Tables?.ok).toBe(false);
    expect(r.Tables?.detail).toContain('missing order_events');
  });

  it('skips the structure, not fails it, when live has a newer migration', () => {
    const r = byName(
      withValues({
        migrations_live: '28 1770000000000',
        schema_live: 'other',
        tables_live: 'orders,order_events,refunds,tickets',
      }),
    );
    expect(r.Migrations?.ok).toBeNull();
    expect(r.Schema?.ok).toBeNull();
    expect(r.Tables?.ok).toBeNull();
  });

  it('skips a table the newer migration dropped, and fails it at the same migration', () => {
    const tables = { tables_backup: 'orders,order_events,old,tickets' };
    const ahead = byName(withValues({ ...tables, migrations_live: '28 1770000000000' }));
    expect(ahead.Tables?.ok).toBeNull();
    expect(ahead.Tables?.detail).toContain('extra old');
    expect(byName(withValues(tables)).Tables?.ok).toBe(false);
  });

  it('fails a query that failed on both sides, not passes it as equal', () => {
    const empty = byName(
      withValues({
        tables_backup: '',
        tables_live: '',
        migrations_backup: '',
        migrations_live: '',
        schema_backup: '',
        schema_live: '',
        rows_orders_backup: '',
        rows_orders_live: '',
      }),
    );
    expect(empty.Tables?.ok).toBe(false);
    expect(empty.Migrations?.ok).toBe(false);
    expect(empty.Schema?.ok).toBe(false);
    expect(empty['Rows: orders']?.ok).toBe(false);
  });

  it('fails a backup ahead of live, and a schema that differs at the same migration', () => {
    expect(byName(withValues({ migrations_backup: '28 1770000000000' })).Migrations?.ok).toBe(
      false,
    );
    expect(byName(withValues({ schema_backup: 'other' })).Schema?.ok).toBe(false);
  });

  it.each(APPEND_ONLY_COUNTS)('fails when %s rows up to the cutoff differ from live', (table) => {
    const r = byName(withValues({ [`rows_${table}_live`]: '999' }));
    expect(r[`Rows: ${table}`]?.ok).toBe(false);
  });

  it('fails an old file uploaded again: live has audit rows past it', () => {
    const r = byName(withValues({ tail_live: '3' }));
    expect(r['Up to date']?.ok).toBe(false);
    expect(r['Up to date']?.detail).toContain('2026-10-26T21:00:00.000Z');
  });

  it('fails a backup with no audit rows when live has some', () => {
    const r = byName(withValues({ cutoff_us: '0', tail_live: '5' }));
    expect(r['Up to date']?.ok).toBe(false);
    expect(r['Up to date']?.detail).toContain('no audit rows');
  });

  it('fails when the app role cannot read, or can change an audit table on either side', () => {
    expect(byName(withValues({ grants: 'failed' }))['App role grants']?.ok).toBe(false);
    expect(byName(withValues({ grants: 'ok ' }))['App role grants']?.ok).toBe(false);
    for (const side of ['backup', 'live']) {
      const r = byName(withValues({ [`audit_writable_${side}`]: '1' }));
      expect(r['Audit append-only']?.ok).toBe(false);
    }
    expect(byName(withValues({ audit_writable_live: '' }))['Audit append-only']?.ok).toBe(false);
  });

  it('fails a run that stopped part-way, or exited non-zero after done=ok', () => {
    expect(byName(parseReport(good.replace('done=ok\n', ''), 0)).Completed?.ok).toBe(false);
    const late = byName(parseReport(good, 2)).Completed;
    expect(late?.ok).toBe(false);
    expect(late?.detail).toContain('exit 2');
  });
});

describe('runError', () => {
  const ok = parseReport(good, 0);
  const failed = parseReport('restore=failed\n', 0);

  it('accepts a finished run, a failed restore included', () => {
    expect(runError(ok, { source: 0 })).toBeNull();
    // A failed restore stops reading, so the download ends early too.
    expect(runError(failed, { source: 1 })).toBeNull();
    expect(runError(parseReport(good, 1))).toBeNull(); // Completed judges it
  });

  it('refuses a run that never reached the restore, or whose input broke', () => {
    expect(runError(parseReport('image=x\n', 2))).toContain('exit 2');
    expect(runError(ok, { input: new Error('ENOENT') })).toContain('ENOENT');
    expect(runError(ok, { source: 1 })).toContain('stream failed');
  });

  it('refuses a report with a repeated key: a value printed lines of its own', () => {
    expect(runError(parseReport(`${good}tail_live=0\n`, 0))).toContain('tail_live');
  });
});

describe('parseArgs', () => {
  it('reads the lab flags', () => {
    expect(parseArgs([])).toEqual({ local: false });
    expect(parseArgs(['--local', '--file', 'x.gz'])).toEqual({ local: true, file: 'x.gz' });
  });

  it('refuses anything that could fall through to production', () => {
    expect(() => parseArgs(['--file', 'x.gz'])).toThrow('--local');
    expect(() => parseArgs(['--local', '--file'])).toThrow('incomplete');
    expect(() => parseArgs(['--locl'])).toThrow('unknown');
  });
});

describe('logRow', () => {
  const row = (report: Report, at = now) =>
    logRow(evaluate(report, backup, backup.size, at), report, backup, at);

  it('dates the row in Dhaka, lists failed checks by name, and counts nothing', () => {
    const late = new Date('2026-10-26T21:45:00Z'); // 03:45 on the 27th in Dhaka
    expect(row(withValues({ rows_tickets_live: '1' }), late)).toBe(
      '| 2026-10-27 | S3 `2026-10-26T21-30-00-123Z.sql.gz` | 2 s | ✗ Rows: tickets |',
    );
  });

  it('logs a run with skipped checks as –, not ✓', () => {
    expect(row(withValues({ migrations_live: '28 1770000000000' }))).toMatch(
      /\| – Migrations, Schema \|$/,
    );
    expect(row(parseReport(good, 0))).toMatch(/\| ✓ \|$/);
  });

  it('prints the restore time only as digits', () => {
    expect(row(withValues({ restore_seconds: '1 | ✓ | x' }))).toContain('| ? s |');
  });
});

describe('ops/db/restore-drill.sh', () => {
  const sh = readFileSync(script, 'utf8');
  const code = sh
    .split('\n')
    .filter((line) => !line.trimStart().startsWith('#'))
    .join('\n');
  const body = (fn: string) =>
    sh.slice(sh.indexOf(`${fn}() {`), sh.indexOf('\n}', sh.indexOf(`${fn}() {`)));

  it('is valid bash with strict mode', () => {
    execFileSync('bash', ['-n', script]);
    expect(sh).toMatch(/^set -euo pipefail$/m);
  });

  it('starts the throwaway locked down, from the live image', () => {
    const run = sh.slice(
      sh.indexOf('docker run'),
      sh.indexOf('"$image"', sh.indexOf('docker run')),
    );
    expect(run).toContain('--network none');
    // Postgres logs a failing row in full; the json-file driver would keep it.
    expect(run).toContain('--log-driver none');
    // Equal limits: no swap, so the tmpfs's pages stay in memory.
    expect(run).toMatch(/--memory (\d+m) --memory-swap \1/);
    // A crafted backup runs SQL as a superuser: no disk, few processes.
    expect(run).toContain('--read-only');
    expect(run).toMatch(/--pids-limit \d+/);
    expect(run).toContain('--oom-score-adj 1000');
    expect(run).toContain('--cap-drop ALL');
    expect(run).toContain('--security-opt no-new-privileges');
    expect(run).not.toMatch(/PGDATA|--privileged|-v |--volume|--mount/);
    expect(sh).toContain(`docker inspect -f '{{.Image}}'`);
  });

  it('removes the throwaway and its volume on every exit, a lost connection included', () => {
    expect(sh).toMatch(/^trap '.*docker rm -fv "\$drill".*' EXIT$/m);
    expect(sh).toMatch(/^trap 'exit \d+' HUP INT TERM PIPE$/m);
    expect(sh).toContain('timeout 600 gunzip -c');
  });

  it('matches the live container by its whole name, and needs exactly one', () => {
    expect(sh).toMatch(/named "\^\$\{live_name.*\(\\\\\.\[0-9\]\+\\\\\.\[a-z0-9\]\+\)\?\\\$"/);
    expect(sh).toContain('-ne 1');
    expect(code).not.toMatch(/docker ps -q -f/);
  });

  it('restores with --exit-on-error and prints only masked error lines', () => {
    expect(sh).toContain('--exit-on-error');
    expect(sh).toMatch(/grep '\^pg_restore: error:' \|\s+awk -f "\$here\/mask-errors\.awk"/);
  });

  it('reads the live database only in read-only transactions, with timeouts', () => {
    // inspect, and the one on_live() exec, which carries PGOPTIONS
    expect([...sh.matchAll(/"\$live_id"/g)].length).toBe(2);
    expect(body('on_live')).toMatch(
      /-e PGOPTIONS='-c default_transaction_read_only=on -c statement_timeout=\d+s -c lock_timeout=\d+s'\s*\\\s*"\$live_id"/,
    );
  });

  it('pastes nothing from the backup into a live query but checked digits', () => {
    expect(code).not.toMatch(/'\$cutoff'/);
    expect(sh).toMatch(/\[\[ \$cutoff_us =~ \^\[0-9\]\+\$ \]\]/);
    expect(sh).toMatch(/\$upload =~ \^\[0-9\]\+\$/);
  });

  it('checks the revoked audit rights by privilege, not by error text', () => {
    expect(sh).toContain("has_table_privilege('echoandaura_app', t, p)");
    for (const table of ['order_events', 'door_scans', 'door_decisions']) {
      expect(sh).toContain(`'${table}'`);
    }
  });

  it('never selects whole rows', () => {
    expect(code).not.toMatch(/select \*/i);
    expect(code).not.toMatch(/\bpg_dump\b/);
  });
});

describe('the live container match', () => {
  // The script's own `named` function, fed a fake `docker ps`.
  const named = sh(readFileSync(script, 'utf8'));
  function sh(source: string) {
    const fn = source.slice(
      source.indexOf('named() {'),
      source.indexOf('\n}', source.indexOf('named() {')) + 2,
    );
    return (pattern: string, names: string[]) =>
      execFileSync(
        'bash',
        [
          '-c',
          `docker() { printf '%s\\n' ${names.map((n) => `'${n}'`).join(' ')}; }\n${fn}\nlive_name=$1\nnamed "${pattern}"`,
          '_',
          'echoandaura-db-ljctqy',
        ],
        { encoding: 'utf8' },
      ).trim();
  }
  // The pattern exactly as the script passes it.
  const live = /live_ids=\$\(named "(.+)"\)/.exec(readFileSync(script, 'utf8'))?.[1] ?? '';

  it('finds the Swarm task and nothing that only starts the same', () => {
    expect(
      named(live, [
        'a1 echoandaura-db-ljctqy.1.aaaaaaaaaaaaaaaaaaaaaaaaa',
        'b2 echoandaura-db-ljctqy-old.1.x',
        'c3 dokploy-postgres.1.bbbbbbbbbbbbbbbbbbbbbbbbb',
      ]),
    ).toBe('a1');
  });
});

/** The server script run for real, against a fake `docker` that logs its
 * arguments and answers each query; `timeout`, `gunzip` and `ps` are real.
 * The env variables steer the fake: a failing live query, a slow restore, a
 * cutoff, the tables, a swap limit, containers left by earlier drills. */
describe('ops/db/restore-drill.sh, run against a fake docker', () => {
  const dir = mkdtempSync(join(tmpdir(), 'restore-drill-'));
  afterAll(() => rmSync(dir, { recursive: true, force: true }));
  writeFileSync(
    join(dir, 'docker'),
    String.raw`#!/usr/bin/env bash
printf '%s\n' "$*" >> "$SHIMLOG"
answer() {
  case "$1" in
    *"show server_version"*) echo 17.0 ;;
    *pg_tables*) printf '%b\n' "${'$'}{TABLES:-orders,order_events,tickets}" ;;
    *drizzle*) echo "27 1760000000000" ;;
    *md5\(*) echo 0123456789abcdef0123456789abcdef ;;
    *"extract(epoch"*) printf '%s\n' "${'$'}{CUTOFF:-1793048400000000}" ;;
    *"created_at >"*) echo 0 ;;
    *"set role"*) echo 5 ;;
    *has_table_privilege*) echo 0 ;;
    *"count(*) from"*) echo 5 ;;
    *) cat >/dev/null ;;
  esac
}
case "$1" in
  ps)
    if [[ " $* " == *" -a "* && -n ${'$'}{STALE:-} ]]; then printf '%b\n' "$STALE"; fi
    echo 'abc123 echoandaura-postgres' ;;
  inspect) [[ "$*" == *OOMKilled* ]] && echo false || echo sha256:img ;;
  image) echo '/var/lib/postgresql/data ' ;;
  run) echo cid ;;
  rm) exit 0 ;;
  exec)
    case "$*" in
      *pg_isready*) exit 0 ;;
      *memory.swap.max*) echo "${'$'}{SWAP-0}" ;;
      *memory.events*) echo 'oom_kill 0' ;;
      *pg_restore*) cat >/dev/null; sleep "${'$'}{SLOW:-0}" ;;
      *PGOPTIONS*)
        if [[ -n ${'$'}{FAIL_LIVE:-} && "$*" == *"$FAIL_LIVE"* ]]; then echo 'ERROR: boom' >&2; exit 1; fi
        answer "$*" ;;
      *) answer "$*" ;;
    esac ;;
esac
`,
  );
  chmodSync(join(dir, 'docker'), 0o755);

  const dump = gzipSync(Buffer.alloc(64 * 1024, 'x'));
  const args = [script, 'echoandaura-postgres', 'echoandaura', 'echoandaura', '1793050000'];
  let runs = 0;
  const setup = (fake: Record<string, string>) => {
    const log = join(dir, `log-${++runs}`);
    writeFileSync(log, '');
    const env = { ...process.env, PATH: `${dir}:${process.env.PATH}`, SHIMLOG: log, ...fake };
    return { log, env, calls: () => readFileSync(log, 'utf8') };
  };
  const drill = (fake: Record<string, string> = {}, input: Buffer = dump) => {
    const { env, calls } = setup(fake);
    const result = spawnSync('bash', args, { input, env, encoding: 'utf8' });
    return { ...result, calls: calls() };
  };
  const removed = (calls: string) => /^rm -fv echoandaura-restore-drill-\d+$/m.test(calls);

  it('passes on a good restore, and removes the throwaway', () => {
    const r = drill();
    expect(r.stderr).not.toContain('could swap');
    expect(r.status).toBe(0);
    const report = parseReport(r.stdout, r.status);
    expect(runError(report)).toBeNull();
    expect(evaluate(report, null, 0, now).filter((c) => c.ok !== true)).toEqual([]);
    expect(r.calls).toMatch(
      /^run .*--read-only .*--tmpfs \/var\/lib\/postgresql\/data:rw,size=512m /m,
    );
    expect(removed(r.calls)).toBe(true);
  });

  it('stops without done=ok when a live query fails, and still cleans up', () => {
    const r = drill({ FAIL_LIVE: 'md5(' });
    expect(r.status).not.toBe(0);
    expect(r.stdout).not.toContain('done=ok');
    expect(r.stdout).not.toContain('schema_backup');
    expect(removed(r.calls)).toBe(true);
  });

  it('refuses a cutoff that is not digits before any live query uses it', () => {
    const r = drill({ CUTOFF: "1; drop table orders; select '" });
    expect(r.status).toBe(2);
    expect(r.calls).not.toMatch(/PGOPTIONS.*created_at <=/);
    expect(removed(r.calls)).toBe(true);
  });

  it('refuses a value of more than one line, which could forge the report', () => {
    const r = drill({ TABLES: 'orders\\ndone=ok' });
    expect(r.status).toBe(2);
    expect(r.stdout).not.toContain('done=ok');
    expect(r.stdout).not.toContain('tables_backup');
  });

  it('reports a truncated backup as a failed restore', () => {
    const r = drill({}, dump.subarray(0, dump.length - 200));
    expect(r.status).toBe(0);
    expect(r.stdout).toContain('restore=failed');
    expect(r.stdout).not.toContain('restore=ok');
    expect(removed(r.calls)).toBe(true);
  });

  it('stops before restoring when the throwaway could swap', () => {
    const r = drill({ SWAP: 'max' });
    expect(r.status).toBe(2);
    expect(r.stderr).toContain('could swap');
    expect(r.calls).not.toContain('pg_restore');
    expect(removed(r.calls)).toBe(true);
  });

  it('removes the throwaway when the laptop stops reading', () => {
    const { env, calls } = setup({});
    spawnSync('bash', ['-c', 'bash "$@" | head -1 >/dev/null', '_', ...args], {
      input: dump,
      env,
    });
    expect(removed(calls())).toBe(true);
  });

  it('removes the throwaway when stopped mid-restore', async () => {
    const { env, calls } = setup({ SLOW: '2' });
    const child = spawn('bash', args, { env, stdio: ['pipe', 'ignore', 'ignore'] });
    child.stdin.end(dump);
    const code = await new Promise<number | null>((resolve) => {
      const started = setInterval(() => {
        if (calls().includes('pg_restore')) {
          clearInterval(started);
          child.kill('SIGTERM');
        }
      }, 50);
      child.on('close', resolve);
    });
    expect(code).toBe(129);
    expect(removed(calls())).toBe(true);
  });

  it('sweeps a throwaway whose drill is gone, and leaves a running one alone', () => {
    const r = drill({
      STALE: `dead1 echoandaura-restore-drill-2147483646\\nlive1 echoandaura-restore-drill-${process.pid}`,
    });
    expect(r.calls).toMatch(/^rm -fv dead1$/m);
    expect(r.calls).not.toMatch(/^rm -fv live1$/m);
  });
});

describe('the masking of restore errors (mask-errors.awk)', () => {
  const mask = (line: string) =>
    execFileSync('awk', ['-f', 'ops/db/mask-errors.awk'], {
      input: `${line}\n`,
      encoding: 'utf8',
    }).trim();

  it('keeps a table and a constraint name', () => {
    const line =
      'pg_restore: error: COPY failed for table "orders": ERROR:  new row for relation "orders" violates check constraint "orders_totals_consistent"';
    expect(mask(line)).toBe(line);
  });

  it.each([
    ['a name and phone', 'invalid input syntax for type uuid: "Rahim 01700000000"', 'Rahim'],
    ['a trxID after a keyword', 'violates unique constraint "TESTTRX001"', 'TESTTRX001'],
    ['a digits-only phone after a keyword', 'for column "01712345678"', '01712345678'],
    ['a quote inside a value', 'value "Rahim "Bob" Khan" in table "orders"', 'Bob'],
    ['a key and its value', 'Key (bkash_trx_id)=(TESTTRX001) already exists', 'TESTTRX001'],
  ])('hides %s', (_, line, secret) => {
    expect(mask(`pg_restore: error: ${line}`)).not.toContain(secret);
  });

  it('drops control characters', () => {
    expect(mask('pg_restore: error: \u001b[2Jx')).toBe('pg_restore: error: [2Jx');
  });
});
