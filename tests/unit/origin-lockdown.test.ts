import { readFileSync } from 'node:fs';
import { isIP } from 'node:net';
import { describe, expect, it } from 'vitest';
import { CLOUDFLARE_RANGES } from '@/lib/client-ip';

/**
 * ADR-045: the server's firewall script (ops/ansible/roles/origin_lockdown/files/origin-lockdown) lets
 * only Cloudflare reach ports 80/443, and the app trusts only Cloudflare's
 * X-Forwarded-For hops (ADR-037). Two copies of one list: if they drift,
 * either real visitors are dropped at the firewall or the rate limiter
 * keys on a Cloudflare edge instead of the visitor.
 */
function scriptRanges(): string[] {
  const script = readFileSync('ops/ansible/roles/origin_lockdown/files/origin-lockdown', 'utf8');
  const block = script.split('# BEGIN CLOUDFLARE RANGES')[1]?.split('# END CLOUDFLARE RANGES')[0];
  if (!block)
    throw new Error(
      'CLOUDFLARE RANGES markers not found in ops/ansible/roles/origin_lockdown/files/origin-lockdown',
    );
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
    const script = readFileSync('ops/ansible/roles/origin_lockdown/files/origin-lockdown', 'utf8');
    const list = (name: string) =>
      (script.match(new RegExp(`^${name}="([^"]*)"`, 'm'))?.[1] ?? '').split(/\s+/).filter(Boolean);
    const v4 = list('V4');
    const v6 = list('V6');
    expect(v4.length + v6.length).toBe(CLOUDFLARE_RANGES.length);
    for (const r of v4) expect(isIP(r.split('/')[0] ?? ''), r).toBe(4);
    for (const r of v6) expect(isIP(r.split('/')[0] ?? ''), r).toBe(6);
  });
});

describe('origin-lockdown hooks', () => {
  const script = readFileSync('ops/ansible/roles/origin_lockdown/files/origin-lockdown', 'utf8');
  const hooks = [
    ...(script.match(/^hooks\(\) \{\n([\s\S]*?)\n\}/m)?.[1] ?? '').matchAll(/echo "(.*)"/g),
  ].map((m) => m[1] ?? '');

  it('send 80/443 (TCP and QUIC) through the Cloudflare-only chain', () => {
    expect(hooks).toContain(
      '-i $IFACE -p tcp -m multiport --dports 80,443 -m conntrack --ctdir ORIGINAL -j $CHAIN',
    );
    expect(hooks).toContain('-i $IFACE -p udp --dport 443 -m conntrack --ctdir ORIGINAL -j $CHAIN');
  });

  // SERVER.md section 9: the Dokploy dashboard's port. Never through the
  // Cloudflare chain (Cloudflare can't reach 3000 anyway, and an allow there
  // would make the dashboard public to anyone behind Cloudflare).
  it('drop 3000 from the internet for everyone', () => {
    const port3000 = hooks.filter((h) => /\b3000\b/.test(h));
    expect(port3000).toEqual([
      '-i $IFACE -p tcp --dport 3000 -m conntrack --ctdir ORIGINAL -j DROP',
    ]);
  });

  it('only ever match the internet-facing interface, so the SSH tunnel (loopback) still works', () => {
    expect(hooks).toHaveLength(3);
    for (const h of hooks) expect(h.startsWith('-i $IFACE ')).toBe(true);
  });
});
