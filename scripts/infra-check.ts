/**
 * `pnpm infra:check` — proves docs/infra/*.md are still true. Read-only.
 *
 * Each row is one claim from AWS.md / CLOUDFLARE.md / EMAIL.md: the CLI
 * identity, IAM keys and policy, budgets, SES identity state, every DNS
 * record, and that Postgres and Redis answer. Needs the `aws` CLI signed
 * in (`aws login --profile echoandaura`) and `dig`; AWS rows are skipped,
 * not failed, when the CLI is absent or signed out. Exits 1 on any ✗.
 */
import { execFile } from 'node:child_process';
import { request } from 'node:https';
import { BlockList, isIP } from 'node:net';
import { promisify } from 'node:util';
import { CLOUDFLARE_RANGES } from '@/lib/client-ip';

const exec = promisify(execFile);

// The account id stays out of this public repo: `.env` → AWS_ACCOUNT_ID.
const ACCOUNT = process.env.AWS_ACCOUNT_ID?.trim() ?? '';
const REGION = 'ap-south-1';
const DOMAIN = 'echoandaura.com';
/** Bounce + complaint notifications for the domain identity (AWS.md § SES). */
const SES_FEEDBACK_TOPIC = `arn:aws:sns:${REGION}:${ACCOUNT}:ses-feedback`;
/** The production VPS (docs/infra/SERVER.md). */
const SERVER_IPV4 = '160.25.226.166';
const DKIM_TOKENS = [
  'tiqho3f6k6gqjjucwewakfvqyjmiu46q',
  'bjtddvusgm23hci2bzarxllb7py7l7kk',
  'tsrr3pkudaqmrgu7hdfft4camf656gro',
];

type Result = { ok: boolean | null; detail: string };
type Check = { name: string; run: () => Promise<Result> };

const pass = (detail: string): Result => ({ ok: true, detail });
const fail = (detail: string): Result => ({ ok: false, detail });
const skip = (detail: string): Result => ({ ok: null, detail });

async function aws(args: string[]): Promise<unknown> {
  const env = { ...process.env, AWS_PROFILE: process.env.AWS_PROFILE ?? 'echoandaura' };
  const { stdout } = await exec('aws', [...args, '--output', 'json'], { env });
  return stdout.trim() ? (JSON.parse(stdout) as unknown) : null;
}

/** Wraps an AWS check so a missing CLI / expired session reads as "skipped". */
function awsCheck(name: string, run: () => Promise<Result>): Check {
  return {
    name,
    run: async () => {
      try {
        return await run();
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        if (/ENOENT/.test(msg)) return skip('aws CLI not installed');
        if (/login session|NoCredentials|ExpiredToken|reauthenticate/i.test(msg)) {
          return skip('not signed in — run: aws login --profile echoandaura');
        }
        return fail(msg.split('\n').find((l) => l.trim()) ?? msg);
      }
    },
  };
}

async function dig(type: string, name: string): Promise<string[]> {
  const { stdout } = await exec('dig', ['+short', type, name]);
  return stdout
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean);
}

const cloudflare = new BlockList();
for (const range of CLOUDFLARE_RANGES) {
  const [network = '', bits = ''] = range.split('/');
  cloudflare.addSubnet(network, Number(bits), network.includes(':') ? 'ipv6' : 'ipv4');
}
const isCloudflare = (ip: string) => isIP(ip) === 4 && cloudflare.check(ip, 'ipv4');

/**
 * ADR-045: HTTPS straight to the server's address, as the site. Resolves to
 * what happened: a status code, or the connection error. The lockdown drops
 * the packets, so the expected outcome is a timeout.
 */
function direct(ip: string, host: string, timeoutMs: number): Promise<string> {
  return new Promise((resolve) => {
    const req = request(
      {
        host: ip,
        port: 443,
        servername: host,
        headers: { host },
        path: '/api/health',
        timeout: timeoutMs,
        rejectUnauthorized: false,
      },
      (res) => {
        res.resume();
        resolve(`HTTP ${res.statusCode}`);
      },
    );
    req.on('timeout', () => req.destroy(new Error('timeout')));
    req.on('error', (err) => resolve(err.message));
    req.end();
  });
}

function dnsCheck(
  name: string,
  type: string,
  host: string,
  expect: (lines: string[]) => string | null,
): Check {
  return {
    name,
    run: async () => {
      try {
        const lines = await dig(type, host);
        const problem = expect(lines);
        return problem
          ? fail(`${problem} (got: ${lines.join(' | ') || 'nothing'})`)
          : pass(lines.join(' | '));
      } catch (err: unknown) {
        return skip(`dig unavailable: ${err instanceof Error ? err.message : String(err)}`);
      }
    },
  };
}

const checks: Check[] = [
  // ---- AWS: identity and IAM (docs/infra/AWS.md) ----
  awsCheck('AWS CLI signed in as ash-admin (never root)', async () => {
    const id = (await aws(['sts', 'get-caller-identity'])) as { Arn: string; Account: string };
    if (!ACCOUNT) return fail('AWS_ACCOUNT_ID is not set in .env');
    if (id.Account !== ACCOUNT) return fail(`account ${id.Account}, expected ${ACCOUNT}`);
    if (/:root$/.test(id.Arn)) return fail('signed in as ROOT — use ash-admin');
    return pass(id.Arn.replace(ACCOUNT, '<account>'));
  }),
  awsCheck('ash-admin has no access keys', async () => {
    const r = (await aws(['iam', 'list-access-keys', '--user-name', 'ash-admin'])) as {
      AccessKeyMetadata: unknown[];
    };
    return r.AccessKeyMetadata.length === 0
      ? pass('0 keys')
      : fail(`${r.AccessKeyMetadata.length} key(s) — delete them`);
  }),
  awsCheck('echoandaura-worker has exactly one active key', async () => {
    const r = (await aws(['iam', 'list-access-keys', '--user-name', 'echoandaura-worker'])) as {
      AccessKeyMetadata: { AccessKeyId: string; Status: string }[];
    };
    const active = r.AccessKeyMetadata.filter((k) => k.Status === 'Active');
    const inEnv = process.env.AWS_SES_ACCESS_KEY_ID;
    if (active.length !== 1) return fail(`${active.length} active (rotation in progress?)`);
    if (inEnv && !active.some((k) => k.AccessKeyId === inEnv))
      return fail('.env key is not the worker’s active key');
    return pass(`${active[0]!.AccessKeyId.slice(0, 8)}…${inEnv ? ' = .env' : ''}`);
  }),
  awsCheck('worker policy is send-only on identity/*', async () => {
    const r = (await aws([
      'iam',
      'get-user-policy',
      '--user-name',
      'echoandaura-worker',
      '--policy-name',
      'ses-send-only',
    ])) as { PolicyDocument: { Statement: { Action: string[]; Resource: string | string[] }[] } };
    const st = r.PolicyDocument.Statement;
    const actions = st
      .flatMap((s) => s.Action)
      .sort()
      .join(',');
    const resources = st.flatMap((s) => (Array.isArray(s.Resource) ? s.Resource : [s.Resource]));
    if (actions !== 'ses:SendEmail,ses:SendRawEmail') return fail(`actions: ${actions}`);
    if (!resources.includes(`arn:aws:ses:${REGION}:${ACCOUNT}:identity/*`))
      return fail(`resource: ${resources.join(', ')}`);
    return pass(actions);
  }),
  awsCheck('worker has no other policies (e.g. AWSDenyAll from the hard stop)', async () => {
    const r = (await aws([
      'iam',
      'list-attached-user-policies',
      '--user-name',
      'echoandaura-worker',
    ])) as {
      AttachedPolicies: { PolicyName: string }[];
    };
    const names = r.AttachedPolicies.map((p) => p.PolicyName);
    return names.length === 0 ? pass('none attached') : fail(`attached: ${names.join(', ')}`);
  }),
  // ---- AWS: budgets ----
  awsCheck('three budgets exist', async () => {
    const r = (await aws(['budgets', 'describe-budgets', '--account-id', ACCOUNT])) as {
      Budgets: { BudgetName: string; BudgetLimit: { Amount: string } }[];
    };
    const names = r.Budgets.map((b) => `${b.BudgetName} ($${Number(b.BudgetLimit.Amount)})`);
    return r.Budgets.length >= 3
      ? pass(names.join(' · '))
      : fail(`only ${r.Budgets.length}: ${names.join(' · ')}`);
  }),
  // ---- AWS: SES ----
  awsCheck('SES domain identity verified, DKIM + MAIL FROM success, no config set', async () => {
    const r = (await aws([
      'sesv2',
      'get-email-identity',
      '--email-identity',
      DOMAIN,
      '--region',
      REGION,
    ])) as {
      VerifiedForSendingStatus: boolean;
      DkimAttributes: { Status: string };
      MailFromAttributes?: { MailFromDomain?: string; MailFromDomainStatus?: string };
      ConfigurationSetName?: string;
    };
    const problems: string[] = [];
    if (!r.VerifiedForSendingStatus) problems.push('not verified');
    if (r.DkimAttributes.Status !== 'SUCCESS') problems.push(`DKIM ${r.DkimAttributes.Status}`);
    if (r.MailFromAttributes?.MailFromDomainStatus !== 'SUCCESS')
      problems.push(`MAIL FROM ${r.MailFromAttributes?.MailFromDomainStatus ?? 'unset'}`);
    if (r.ConfigurationSetName)
      problems.push(`default configuration set "${r.ConfigurationSetName}" — remove it`);
    return problems.length
      ? fail(problems.join('; '))
      : pass(`verified · DKIM · MAIL FROM ${r.MailFromAttributes?.MailFromDomain}`);
  }),
  // VDM and Auto Validation are billed per message; Auto Validation also
  // drops "risky" recipients silently, which would lose a buyer's tickets.
  awsCheck('SES suppression list on; VDM and Auto Validation off', async () => {
    const r = (await aws(['sesv2', 'get-account', '--region', REGION])) as {
      VdmAttributes?: { VdmEnabled?: string };
      SuppressionAttributes?: {
        SuppressedReasons?: string[];
        ValidationAttributes?: { ConditionThreshold?: { ConditionThresholdEnabled?: string } };
      };
    };
    const problems: string[] = [];
    const reasons = r.SuppressionAttributes?.SuppressedReasons ?? [];
    if (!reasons.includes('BOUNCE') || !reasons.includes('COMPLAINT'))
      problems.push(`suppression reasons: ${reasons.join(',') || 'none'}`);
    if (r.VdmAttributes?.VdmEnabled === 'ENABLED') problems.push('VDM enabled');
    const av = r.SuppressionAttributes?.ValidationAttributes?.ConditionThreshold;
    if (av?.ConditionThresholdEnabled === 'ENABLED') problems.push('Auto Validation enabled');
    return problems.length
      ? fail(problems.join('; '))
      : pass('BOUNCE + COMPLAINT · VDM off · AV off');
  }),
  awsCheck('SES bounces + complaints → SNS ses-feedback, forwarding off', async () => {
    const r = (await aws([
      'ses',
      'get-identity-notification-attributes',
      '--identities',
      DOMAIN,
      '--region',
      REGION,
    ])) as {
      NotificationAttributes: Record<
        string,
        { BounceTopic?: string; ComplaintTopic?: string; ForwardingEnabled: boolean }
      >;
    };
    const n = r.NotificationAttributes[DOMAIN];
    if (!n) return fail('no notification attributes for the domain');
    const problems: string[] = [];
    if (n.BounceTopic !== SES_FEEDBACK_TOPIC) problems.push(`bounce → ${n.BounceTopic ?? 'none'}`);
    if (n.ComplaintTopic !== SES_FEEDBACK_TOPIC)
      problems.push(`complaint → ${n.ComplaintTopic ?? 'none'}`);
    // SES turns forwarding back on by itself when it cannot publish to the
    // topic, so `true` here means the topic or its policy is broken.
    if (n.ForwardingEnabled)
      problems.push('email forwarding on (SES re-enables it on publish failure)');
    return problems.length ? fail(problems.join('; ')) : pass('bounce · complaint → ses-feedback');
  }),
  awsCheck('ses-feedback: SES-only publish policy, a confirmed subscriber', async () => {
    const r = (await aws([
      'sns',
      'get-topic-attributes',
      '--topic-arn',
      SES_FEEDBACK_TOPIC,
      '--region',
      REGION,
    ])) as { Attributes: { Policy: string; SubscriptionsConfirmed: string } };
    const policy = JSON.parse(r.Attributes.Policy) as {
      Statement: {
        Principal?: { Service?: string };
        Action?: string;
        Condition?: { StringEquals?: Record<string, string> };
      }[];
    };
    const identityArn = `arn:aws:ses:${REGION}:${ACCOUNT}:identity/${DOMAIN}`;
    const sesOk = policy.Statement.some(
      (s) =>
        s.Principal?.Service === 'ses.amazonaws.com' &&
        s.Action === 'sns:Publish' &&
        s.Condition?.StringEquals?.['AWS:SourceAccount'] === ACCOUNT &&
        s.Condition.StringEquals['AWS:SourceArn'] === identityArn,
    );
    const problems: string[] = [];
    if (!sesOk) problems.push('policy lacks the scoped ses.amazonaws.com publish statement');
    const confirmed = Number(r.Attributes.SubscriptionsConfirmed);
    if (confirmed < 1) problems.push('no confirmed subscription — nobody hears about bounces');
    return problems.length
      ? fail(problems.join('; '))
      : pass(`policy scoped to ${DOMAIN} · ${confirmed} confirmed`);
  }),
  awsCheck('SES production access', async () => {
    const r = (await aws(['sesv2', 'get-account', '--region', REGION])) as {
      ProductionAccessEnabled: boolean;
      SendQuota: { Max24HourSend: number; MaxSendRate: number };
    };
    const q = `${r.SendQuota.Max24HourSend}/day · ${r.SendQuota.MaxSendRate}/s`;
    return r.ProductionAccessEnabled
      ? pass(`enabled · ${q}`)
      : skip(`SANDBOX (${q}) — verified recipients only`);
  }),
  // ---- DNS (docs/infra/CLOUDFLARE.md) ----
  dnsCheck('NS at Cloudflare', 'NS', DOMAIN, (l) =>
    l.every((x) => /ns\.cloudflare\.com\.$/.test(x)) && l.length ? null : 'not Cloudflare',
  ),
  ...DKIM_TOKENS.map((t, i) =>
    dnsCheck(`DKIM CNAME ${i + 1}/3`, 'CNAME', `${t}._domainkey.${DOMAIN}`, (l) =>
      l.includes(`${t}.dkim.amazonses.com.`) ? null : 'missing or wrong target (proxied?)',
    ),
  ),
  dnsCheck('SPF on root: one record, Cloudflare + SES', 'TXT', DOMAIN, (l) => {
    const spf = l.filter((x) => x.includes('v=spf1'));
    if (spf.length !== 1) return `${spf.length} SPF records (must be exactly 1)`;
    if (!spf[0]!.includes('include:amazonses.com')) return 'missing include:amazonses.com';
    if (!spf[0]!.includes('include:_spf.mx.cloudflare.net'))
      return 'missing include:_spf.mx.cloudflare.net';
    return null;
  }),
  // ADR-042: Search Console's domain property hangs on this record.
  dnsCheck('Google Search Console verification TXT', 'TXT', DOMAIN, (l) =>
    l.some((x) => x.includes('google-site-verification='))
      ? null
      : 'missing: Search Console loses the domain',
  ),
  dnsCheck('DMARC published', 'TXT', `_dmarc.${DOMAIN}`, (l) =>
    l.some((x) => x.includes('v=DMARC1')) ? null : 'no DMARC record',
  ),
  dnsCheck('MX root → Cloudflare Email Routing', 'MX', DOMAIN, (l) =>
    l.length === 3 && l.every((x) => /mx\.cloudflare\.net\.$/.test(x))
      ? null
      : 'expected 3 route*.mx.cloudflare.net',
  ),
  dnsCheck('MAIL FROM MX', 'MX', `mail.${DOMAIN}`, (l) =>
    l.some((x) => x.includes(`feedback-smtp.${REGION}.amazonses.com`))
      ? null
      : 'missing SES feedback MX',
  ),
  dnsCheck('MAIL FROM SPF', 'TXT', `mail.${DOMAIN}`, (l) =>
    l.some((x) => x.includes('include:amazonses.com')) ? null : 'missing SPF on mail.',
  ),
  // ADR-045: proxied, like the site, since the server accepts web traffic
  // from Cloudflare only. A WAF skip rule keeps Cloudflare's bot checks off
  // /api/*, where GitHub's deploy call goes (CLOUDFLARE.md).
  dnsCheck('deploy → proxied through Cloudflare', 'A', `deploy.${DOMAIN}`, (l) =>
    l.length > 0 && l.every(isCloudflare)
      ? null
      : `expected Cloudflare addresses, got ${l.join(' ')}`,
  ),
  {
    name: 'origin refuses direct HTTPS (lockdown)',
    run: async () => {
      const outcome = await direct(SERVER_IPV4, DOMAIN, 6000);
      return outcome.startsWith('HTTP')
        ? fail(`${SERVER_IPV4} answered ${outcome}: the lockdown is off (SERVER.md § 20)`)
        : pass(`${SERVER_IPV4}: ${outcome}`);
    },
  },
  // ---- local services ----
  {
    name: 'Postgres answers (DATABASE_URL)',
    run: async () => {
      if (!process.env.DATABASE_URL) return skip('DATABASE_URL unset');
      try {
        const { default: postgres } = await import('postgres');
        const sql = postgres(process.env.DATABASE_URL, { max: 1, connect_timeout: 5 });
        const [row] = await sql<{ v: string }[]>`select version() as v`;
        await sql.end();
        return pass(row?.v.split(' ').slice(0, 2).join(' ') ?? 'ok');
      } catch (err: unknown) {
        return fail(err instanceof Error ? err.message : String(err));
      }
    },
  },
  {
    name: 'Redis answers (REDIS_URL)',
    run: async () => {
      if (!process.env.REDIS_URL) return skip('REDIS_URL unset');
      try {
        const { default: IORedis } = await import('ioredis');
        const r = new IORedis(process.env.REDIS_URL, {
          connectTimeout: 5000,
          maxRetriesPerRequest: 1,
          lazyConnect: true,
        });
        await r.connect();
        const pong = await r.ping();
        await r.quit();
        return pass(pong);
      } catch (err: unknown) {
        return fail(err instanceof Error ? err.message : String(err));
      }
    },
  },
  {
    name: 'MAILER / EMAIL_FROM in .env',
    run: async () => {
      const m = process.env.MAILER ?? '(unset → log)';
      const from = process.env.EMAIL_FROM ?? '';
      if (m === 'ses' && !/^[\x20-\x7e]*<[^>]+@echoandaura\.com>$/.test(from)) {
        return fail(`EMAIL_FROM "${from}" — must be ASCII display name <user@${DOMAIN}>`);
      }
      return pass(`MAILER=${m}${from ? ` · from ${from}` : ''}`);
    },
  },
];

async function main(): Promise<void> {
  let failed = 0;
  const width = Math.max(...checks.map((c) => c.name.length));
  for (const c of checks) {
    const r = await c.run();
    const mark = r.ok === true ? '✓' : r.ok === false ? '✗' : '–';
    if (r.ok === false) failed++;
    console.log(`${mark} ${c.name.padEnd(width)}  ${r.detail}`);
  }
  console.log(failed ? `\n${failed} check(s) failed — see docs/infra/` : '\nall checks green');
  process.exit(failed ? 1 : 0);
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
