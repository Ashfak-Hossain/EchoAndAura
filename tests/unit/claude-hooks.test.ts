import { spawnSync } from 'node:child_process';
import { accessSync, constants, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

// ADR-072: the Claude Code guardrails. Each hook runs as Claude Code runs
// it: the tool call as JSON on stdin; exit 2 refuses, exit 0 lets it through.
const run = (hook: string, toolInput: Record<string, string>) =>
  spawnSync('bash', [`.claude/hooks/${hook}`], {
    input: JSON.stringify({ tool_input: toolInput }),
    encoding: 'utf8',
  });
const bash = (command: string) => run('guard-bash.sh', { command });
const write = (content: string) => run('no-secrets.sh', { content });

// Fake secrets are assembled at run time: written whole, the secret check
// would (rightly) refuse this very file.
const join = (...parts: string[]) => parts.join('');

describe('guard-bash: production is read-only for Claude', () => {
  it.each([
    [
      'the go-live wipe',
      `ssh echoandaura 'docker exec -i $C psql -U echoandaura -d echoandaura -c "BEGIN; TRUNCATE orders, tickets; COMMIT;"'`,
    ],
    ['a delete', `ssh echoandaura 'docker exec $C psql -c "delete from users where role = 1"'`],
    ['a grant', `ssh echoandaura 'psql -c "GRANT ALL ON orders TO x"'`],
    ['a restore', `ssh echoandaura 'docker exec -i $C pg_restore -d echoandaura < /root/x.dump'`],
    ['a dump written on the server', `ssh echoandaura 'pg_dump -Fc echoandaura > /root/x.dump'`],
    ['a file removed', `ssh -o BatchMode=yes echoandaura 'rm /root/before-wipe.dump'`],
    ['a container restart', `ssh echoandaura 'docker restart echoandaura-app-web-1'`],
    ['a service update', `ssh echoandaura 'docker service update --force echoandaura-db'`],
    ['a queue clean', `ssh echoandaura 'docker exec $W node -e "await q.clean(0, 1000, 1)"'`],
    ['a redis write', `ssh echoandaura 'docker exec $R redis-cli -a "$A" DEL bull:orders:1'`],
    ['a firewall change', `ssh echoandaura 'ufw allow 3000'`],
    ['a reboot', `ssh echoandaura 'reboot'`],
    ['by address', `ssh root@160.25.226.166 'systemctl restart docker'`],
  ])('refuses %s', (_, command) => {
    const result = bash(command);
    expect(result.status).toBe(2);
    expect(result.stderr).toContain('Give the owner the exact command');
  });

  it.each([
    [
      'row counts',
      `ssh echoandaura 'C=$(docker ps -q -f name=echoandaura-db | head -1); docker exec $C psql -U echoandaura -d echoandaura -At -c "select count(*) from orders"'`,
    ],
    ['the settings row', `ssh echoandaura 'docker exec $C psql -x -c "select * from settings"'`],
    ['a dump listing', `ssh echoandaura 'docker exec -i $C pg_restore -l < /root/x.dump | wc -l'`],
    [
      'the machine',
      `ssh echoandaura 'nproc; free -h; df -h /; swapon --show; mount | head -3; uptime'`,
    ],
    [
      'containers',
      `ssh echoandaura 'docker ps --format "{{.Names}}"; docker inspect -f "{{.State.StartedAt}}" x; docker service ls'`,
    ],
    [
      'queue counts',
      `ssh echoandaura 'docker exec -w /app $W node -e "await q.getJobCounts(); (await q.getJobSchedulers()).map(s => s.key)"'`,
    ],
    ['redis reads', `ssh echoandaura 'r(){ redis-cli "$@"; }; r ZRANGE bull:orders:failed 0 -1'`],
    ['logs', `ssh echoandaura 'docker logs --since 1h echoandaura-app-worker-1 2>&1 | tail'`],
  ])('allows %s', (_, command) => {
    expect(bash(command).status).toBe(0);
  });
});

describe('guard-bash: tags, releases and merges are the owner’s', () => {
  it.each([
    'git tag -a v1.1.0 -m "v1.1.0"',
    'git tag v1.1.0',
    'git tag -d v1.0.0',
    'git tag -f v1.0.0 HEAD',
    'git switch main && git pull && git tag -a v1.1.0 -m v1.1.0',
    'git push origin v1.1.0',
    'git push --tags',
    'gh release create v1.1.0 --generate-notes',
    'gh release delete v1.0.0 --yes',
    'gh pr merge 102 --merge',
  ])('refuses %s', (command) => {
    expect(bash(command).status).toBe(2);
  });

  it.each([
    'git tag',
    'git tag -l',
    'git tag --list "v1.*"',
    'git tag --sort=-creatordate | head -3',
    'git tag --points-at HEAD',
    'gh release view v1.0.0',
    'gh release list --limit 5',
    'gh pr view 101 --json state',
    // Mentioning a command is not running it.
    `grep -n "gh release create" .github/workflows/release.yml`,
    `grep -rn 'git tag -a v1.0.0' docs/DEVELOPMENT.md`,
  ])('allows %s', (command) => {
    expect(bash(command).status).toBe(0);
  });
});

describe('guard-bash: nothing outward-facing runs from a session', () => {
  it.each([
    'gh api -X PUT repos/o/r/rulesets/1',
    'gh api repos/o/r/rulesets -f name=tags',
    'gh secret set SENTRY_AUTH_TOKEN',
    'gh workflow run deploy.yml',
    'gh repo edit --visibility private',
    'pnpm tf:aws apply',
    'cd ops && dotenv -e .env -- terraform -chdir=ops/terraform/aws apply',
    'pnpm ansible apply production',
    'ansible-playbook -i inventory site.yml',
    'npx wrangler deploy -c relay/wrangler.toml',
    'pnpm relay:deploy',
    'docker push ghcr.io/ashfak-hossain/echoandaura-web:main',
    'docker buildx imagetools create -t a:v1 a:sha-1',
    'aws sesv2 put-account-details --mail-type TRANSACTIONAL',
    'aws s3 cp ./backup.sql s3://echoandaura-offsite-backups/x',
    'aws s3 rm s3://bucket/key',
  ])('refuses %s', (command) => {
    expect(bash(command).status).toBe(2);
  });

  it.each([
    'gh api user --jq .login',
    'gh api -X GET search/issues -f q=repo:o/r',
    'pnpm tf:aws plan',
    'pnpm ansible check production',
    'ansible-playbook --check --diff site.yml',
    'docker buildx imagetools inspect ghcr.io/ashfak-hossain/echoandaura-web:v1.0.0',
    'aws sts get-caller-identity',
    'aws s3 cp s3://bucket/key ./local',
    'pnpm verify',
  ])('allows %s', (command) => {
    expect(bash(command).status).toBe(0);
  });
});

describe('guard-bash: the restore drill is the owner’s (ADR-088)', () => {
  it.each([
    'pnpm backup:drill',
    'pnpm run backup:drill',
    'aws login --profile echoandaura && pnpm backup:drill',
    'pnpm backup:drill --file x.gz',
    'dotenv -e .env -- tsx scripts/restore-drill.ts',
    'node --import tsx scripts/restore-drill.ts',
    `ssh echoandaura 'bash /tmp/tmp.abc/restore-drill.sh echoandaura-db-ljctqy echoandaura echoandaura 1'`,
    // Flags before the script name, other package managers, wrappers.
    'pnpm -s backup:drill',
    'pnpm --silent backup:drill',
    'pnpm run --silent backup:drill',
    'pnpm -C . backup:drill',
    'pnpm --dir . backup:drill',
    'pnpm "backup:drill"',
    'pnpm backup:drill>out.txt',
    'time pnpm backup:drill',
    'npm run backup:drill',
    'corepack pnpm backup:drill',
    // The script by any runner, and a --local that isn't its flag.
    'pnpm tsx scripts/restore-drill.ts',
    'npx -y tsx scripts/restore-drill.ts',
    'node_modules/.bin/tsx scripts/restore-drill.ts',
    'tsx scripts/restore-drill',
    'tsx scripts/restore-drill.ts # --local',
    'LAB=--local tsx scripts/restore-drill.ts',
  ])('refuses %s', (command) => {
    const result = bash(command);
    expect(result.status).toBe(2);
    expect(result.stderr).toContain('backup:drill-lab');
  });

  it.each([
    'pnpm backup:drill-lab',
    'pnpm backup:drill-lab --file /tmp/x.sql.gz',
    'dotenv -e .env -- tsx scripts/restore-drill.ts --local',
    'pnpm -s backup:drill-lab',
    'grep -n backup:drill package.json',
    'pnpm vitest run tests/unit/restore-drill.test.ts',
    'pnpm exec eslint scripts/restore-drill.ts',
    `ssh echoandaura 'docker ps -a --format "{{.Names}}" | grep -c echoandaura-restore-drill'`,
  ])('allows %s', (command) => {
    expect(bash(command).status).toBe(0);
  });

  it('is denied in the settings too', () => {
    const { permissions } = JSON.parse(readFileSync('.claude/settings.json', 'utf8')) as {
      permissions: { deny: string[] };
    };
    expect(permissions.deny).toEqual(
      expect.arrayContaining([
        'Bash(pnpm backup:drill)',
        'Bash(pnpm backup:drill *)',
        'Bash(pnpm run backup:drill)',
        'Bash(pnpm run backup:drill *)',
        'Bash(npm run backup:drill)',
        'Bash(npm run backup:drill *)',
        'Bash(pnpm tsx scripts/restore-drill*)',
        'Bash(npx tsx scripts/restore-drill*)',
        'Bash(tsx scripts/restore-drill*)',
      ]),
    );
    // `backup:drill*`, without the space, would deny the lab too.
    expect(permissions.deny.filter((rule) => rule.includes('backup:drill*'))).toEqual([]);
  });
});

describe('no-secrets: writes that look like committed secrets', () => {
  it.each([
    ['a Sentry token', join('SENTRY_AUTH_TOKEN=sntrys', '_eyJpYXQiOjE3OTAwMDAwMDAuMCwidXJsIjoi')],
    ['a relay secret', join('RELAY_SECRET=', 'Zx9fK2mQ8pL4vR7tY1wB6nC3')],
    [
      'a Cloudflare token',
      join("CLOUDFLARE_EMAIL_API_TOKEN: '", "aB3dE5fG7hJ9kL1mN3pQ5rS7tU9vW1xY3z'"),
    ],
    [
      'a database password',
      join('DATABASE_URL=postgresql://app:', 'Sup3rS3cretPw@db.internal:5432/x'),
    ],
    ['an AWS key id', join('AWS_SES_ACCESS_KEY_ID=AKIA', 'QWERTYUIOPASDFGH')],
  ])('refuses %s', (_, content) => {
    expect(write(content).status).toBe(2);
  });

  it.each([
    ["AWS's documented example", 'SECRET_ACCESS_KEY=wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY'],
    ["Turnstile's test key", "TURNSTILE_SECRET_KEY: '3x0000000000000000000000000000000AA'"],
    ['another constant', 'TURNSTILE_SECRET_KEY: TURNSTILE_TEST_SECRET_KEY'],
    ['a docs placeholder', 'postgresql://echoandaura_app:<password>@echoandaura-db:5432/x'],
    ['a local service', 'DATABASE_URL=postgresql://echoandaura:local-password@localhost:5432/x'],
    ['a hyphenated CI placeholder', 'BETTER_AUTH_SECRET: ci-only-placeholder-never-used-0000'],
  ])('allows %s', (_, content) => {
    expect(write(content).status).toBe(0);
  });
});

describe('the hooks are wired up', () => {
  const settings = JSON.parse(readFileSync('.claude/settings.json', 'utf8')) as {
    hooks: Record<string, { matcher?: string; hooks: { command: string }[] }[]>;
    statusLine: { command: string };
  };
  const commandFor = (event: string, matcher: string) =>
    settings.hooks[event]?.find((entry) => entry.matcher === matcher)?.hooks[0]?.command;

  it('runs the Bash guard before every shell command and the secret check before every write', () => {
    expect(commandFor('PreToolUse', 'Bash')).toBe(
      '$CLAUDE_PROJECT_DIR/.claude/hooks/guard-bash.sh',
    );
    expect(commandFor('PreToolUse', 'Write|Edit')).toBe(
      '$CLAUDE_PROJECT_DIR/.claude/hooks/no-secrets.sh',
    );
  });

  it('ships every hook script and the status line as executables', () => {
    for (const file of [
      '.claude/hooks/guard-bash.sh',
      '.claude/hooks/no-secrets.sh',
      '.claude/hooks/format.sh',
      '.claude/statusline.sh',
    ]) {
      expect(() => accessSync(file, constants.X_OK)).not.toThrow();
    }
    expect(settings.statusLine.command).toBe('$CLAUDE_PROJECT_DIR/.claude/statusline.sh');
  });
});
