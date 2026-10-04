import { describe, expect, it, vi } from 'vitest';
import { verifyRelayPass } from '@/server/lib/relay-pass';
import { enqueueRelayAnnounce, type RelayQueue } from '@/server/queue/producer';
import {
  type Fetch,
  RelayRejectedError,
  createRelayAnnouncer,
  readRelayConfig,
  signRelayTicket,
  toWire,
} from '@/server/relay/relay';

const SECRET = 'a-test-relay-secret-that-is-long-enough-0123';
const EVENT = '6f1c2b8e-3a4d-4c5e-9f60-718293a4b5c6';
const PASS = '0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d';
const TICKET = 'a1a1a1a1-1111-4111-8111-111111111111';
const NOW = new Date('2026-10-10T18:00:00Z');
const vars = (v: Record<string, string>) => v as unknown as NodeJS.ProcessEnv;
const config = { httpOrigin: 'https://relay.test', wsOrigin: 'wss://relay.test', secret: SECRET };

describe('readRelayConfig', () => {
  it('is off with neither value, and reads both', () => {
    expect(readRelayConfig(vars({}))).toBeNull();
    expect(
      readRelayConfig(vars({ RELAY_URL: 'https://relay.echoandaura.com/', RELAY_SECRET: SECRET })),
    ).toEqual({
      httpOrigin: 'https://relay.echoandaura.com',
      wsOrigin: 'wss://relay.echoandaura.com',
      secret: SECRET,
    });
    expect(
      readRelayConfig(vars({ RELAY_URL: 'http://localhost:8787', RELAY_SECRET: SECRET }))?.wsOrigin,
    ).toBe('ws://localhost:8787');
  });

  it('refuses half a config, a short secret, or a non-URL — loudly, at boot', () => {
    expect(() => readRelayConfig(vars({ RELAY_URL: 'https://relay.test' }))).toThrow(/together/);
    expect(() => readRelayConfig(vars({ RELAY_SECRET: SECRET }))).toThrow(/together/);
    expect(() =>
      readRelayConfig(vars({ RELAY_URL: 'https://relay.test', RELAY_SECRET: 'short' })),
    ).toThrow(/at least 32/);
    expect(() => readRelayConfig(vars({ RELAY_URL: 'relay', RELAY_SECRET: SECRET }))).toThrow(
      /not a URL/,
    );
    expect(() =>
      readRelayConfig(vars({ RELAY_URL: 'ftp://relay.test', RELAY_SECRET: SECRET })),
    ).toThrow(/http/);
  });
});

describe('relay passes', () => {
  it("signs a phone's pass the relay will accept, for this event and gate", async () => {
    const until = new Date(NOW.getTime() + 3_600_000);
    const t = await signRelayTicket(config, {
      eventId: EVENT,
      passId: PASS,
      gate: 'Gate A',
      until,
    });
    expect(t.url).toBe(`wss://relay.test/events/${EVENT}/ws`);
    expect(await verifyRelayPass(t.pass, SECRET, NOW.getTime())).toEqual({
      v: 1,
      role: 'gate',
      eventId: EVENT,
      passId: PASS,
      gate: 'Gate A',
      exp: until.getTime() / 1000,
    });
  });
});

describe('relay announcements', () => {
  it('travel through the queue as JSON, with retries', async () => {
    const add = vi.fn<RelayQueue['add']>(async () => ({}));
    const message = toWire({ kind: 'undo', ticketId: TICKET, at: NOW });
    expect(message).toEqual({ kind: 'undo', ticketId: TICKET, at: NOW.toISOString() });
    await enqueueRelayAnnounce({ eventId: EVENT, message }, { queue: { add } });
    const [name, data, opts] = add.mock.calls[0]!;
    expect(name).toBe('relay.announce');
    expect(data).toEqual({ eventId: EVENT, message });
    expect(opts).toMatchObject({ attempts: 6, backoff: { type: 'exponential' } });
  });

  it('a revoke keeps trying for hours: a leaked pass stays usable in the room until it lands', async () => {
    const add = vi.fn<RelayQueue['add']>(async () => ({}));
    const message = toWire({ kind: 'revoke', passId: PASS, until: NOW });
    expect(message).toEqual({ kind: 'revoke', passId: PASS, until: NOW.toISOString() });
    await enqueueRelayAnnounce({ eventId: EVENT, message }, { queue: { add } });
    expect(add.mock.calls[0]![2]).toMatchObject({ attempts: 12 });
  });

  it('a stuck queue fails fast instead of holding the gate', async () => {
    const add = vi.fn<RelayQueue['add']>(() => new Promise(() => {}));
    await expect(
      enqueueRelayAnnounce(
        { eventId: EVENT, message: { kind: 'revoke', passId: PASS, until: NOW.toISOString() } },
        { queue: { add }, timeoutMs: 10 },
      ),
    ).rejects.toThrow(/timed out/);
  });

  it('the worker sends each with a short-lived server pass', async () => {
    const fetch = vi.fn<Fetch>(async () => new Response(null, { status: 204 }));
    const message = toWire({ kind: 'in', ticketId: TICKET, at: NOW, gate: 'Gate A' });
    await createRelayAnnouncer(config, fetch, () => NOW).send(EVENT, message);
    const [url, init] = fetch.mock.calls[0]!;
    expect(url).toBe(`https://relay.test/events/${EVENT}/announce`);
    expect(JSON.parse(String(init.body))).toEqual(message);
    const token = (init.headers as Record<string, string>).Authorization!.replace('Bearer ', '');
    const claims = await verifyRelayPass(token, SECRET, NOW.getTime());
    expect(claims).toMatchObject({ role: 'server', eventId: EVENT });
    expect(claims!.exp - NOW.getTime() / 1000).toBeLessThanOrEqual(60);
    expect(init.signal).toBeInstanceOf(AbortSignal);
  });

  it('throws on failure so the queue retries — except a body the relay will never take', async () => {
    const send = (fetch: Fetch) =>
      createRelayAnnouncer(config, fetch, () => NOW).send(EVENT, {
        kind: 'revoke',
        passId: PASS,
        until: NOW.toISOString(),
      });
    await expect(send(async () => new Response('down', { status: 503 }))).rejects.toThrow(/503/);
    await expect(send(async () => new Response('no', { status: 401 }))).rejects.toThrow(/401/);
    await expect(
      send(async () => {
        throw new TypeError('fetch failed');
      }),
    ).rejects.toThrow('fetch failed');
    await expect(send(async () => new Response('bad', { status: 400 }))).rejects.toBeInstanceOf(
      RelayRejectedError,
    );
  });
});
