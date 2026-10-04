import { describe, expect, it } from 'vitest';
import { type RelayClaims, signRelayPass, verifyRelayPass } from '@/server/lib/relay-pass';

const SECRET = 'a-test-relay-secret-that-is-long-enough-0123';
const NOW = Date.parse('2026-10-10T18:00:00Z');
const gate: RelayClaims = {
  v: 1,
  role: 'gate',
  eventId: '6f1c2b8e-3a4d-4c5e-9f60-718293a4b5c6',
  passId: '0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d',
  gate: 'Gate A',
  exp: NOW / 1000 + 3600,
};

describe('relay pass', () => {
  it('round-trips: what our server signs, the relay reads back', async () => {
    const token = await signRelayPass(gate, SECRET);
    expect(token).toMatch(/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/);
    expect(await verifyRelayPass(token, SECRET, NOW)).toEqual(gate);
  });

  it('a server pass needs no gate', async () => {
    const server: RelayClaims = { v: 1, role: 'server', eventId: gate.eventId, exp: gate.exp };
    expect(await verifyRelayPass(await signRelayPass(server, SECRET), SECRET, NOW)).toEqual(server);
  });

  it('refuses an expired pass, another secret, and any change to the claims', async () => {
    const token = await signRelayPass(gate, SECRET);
    expect(await verifyRelayPass(token, SECRET, gate.exp * 1000)).toBeNull();
    expect(await verifyRelayPass(token, `${SECRET}-other`, NOW)).toBeNull();

    // Another gate's name under the same signature.
    const [, sig] = token.split('.');
    const forged = btoa(JSON.stringify({ ...gate, gate: 'Gate Z' }))
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/, '');
    expect(await verifyRelayPass(`${forged}.${sig}`, SECRET, NOW)).toBeNull();
  });

  it('refuses junk without throwing', async () => {
    for (const junk of ['', 'abc', 'a.b.c', '!!.??', `${btoa('{')}.${btoa('x')}`]) {
      expect(await verifyRelayPass(junk, SECRET, NOW)).toBeNull();
    }
  });

  it('never signs bad claims or with a short secret', async () => {
    await expect(signRelayPass({ ...gate, passId: 'nope' }, SECRET)).rejects.toThrow(
      /invalid claims/,
    );
    await expect(signRelayPass({ ...gate, gate: '' }, SECRET)).rejects.toThrow(/invalid claims/);
    await expect(signRelayPass(gate, 'short')).rejects.toThrow(/at least 32/);
  });
});
