import { readFileSync } from 'node:fs';
import { isIP } from 'node:net';
import { describe, expect, it } from 'vitest';
import { CLOUDFLARE_RANGES } from '@/lib/client-ip';

/**
 * ADR-045: the server's firewall script (ops/server/origin-lockdown) lets
 * only Cloudflare reach ports 80/443, and the app trusts only Cloudflare's
 * X-Forwarded-For hops (ADR-037). Two copies of one list: if they drift,
 * either real visitors are dropped at the firewall or the rate limiter
 * keys on a Cloudflare edge instead of the visitor.
 */
function scriptRanges(): string[] {
  const script = readFileSync('ops/server/origin-lockdown', 'utf8');
  const block = script.split('# BEGIN CLOUDFLARE RANGES')[1]?.split('# END CLOUDFLARE RANGES')[0];
  if (!block) throw new Error('CLOUDFLARE RANGES markers not found in ops/server/origin-lockdown');
  return block
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => /^[0-9a-f:.]+\/\d+$/i.test(l));
}

describe('origin-lockdown ranges', () => {
  it('are exactly the ranges the app trusts', () => {
    expect([...scriptRanges()].sort()).toEqual([...CLOUDFLARE_RANGES].sort());
  });

  it('keeps IPv4 in V4 and IPv6 in V6', () => {
    const script = readFileSync('ops/server/origin-lockdown', 'utf8');
    const list = (name: string) =>
      (script.match(new RegExp(`^${name}="([^"]*)"`, 'm'))?.[1] ?? '').split(/\s+/).filter(Boolean);
    const v4 = list('V4');
    const v6 = list('V6');
    expect(v4.length + v6.length).toBe(CLOUDFLARE_RANGES.length);
    for (const r of v4) expect(isIP(r.split('/')[0] ?? ''), r).toBe(4);
    for (const r of v6) expect(isIP(r.split('/')[0] ?? ''), r).toBe(6);
  });
});
