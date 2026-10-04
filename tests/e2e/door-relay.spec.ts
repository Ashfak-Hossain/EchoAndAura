import { randomUUID } from 'node:crypto';
import type { APIRequestContext } from '@playwright/test';
import { type RelayClaims, signRelayPass } from '@/server/lib/relay-pass';
import { RELAY_PROTOCOL } from '@/server/lib/relay-protocol';
import { expect, test } from './test';
import { RELAY_SECRET, RELAY_URL } from './relay-env';
import { signInAsAdmin } from './fixtures/admin';
import {
  dismiss,
  issuedOrder,
  newGatePass,
  openDoors,
  publishedEvent,
  typeCode,
} from './door-helpers';

/**
 * ADR-058: gates share check-ins through the Cloudflare relay (run locally
 * by wrangler) within a fraction of a second — with the status ping cut,
 * and with our server out of reach entirely.
 */
test('the relay tells every gate at once, with or without our server', async ({
  page,
  browser,
}) => {
  test.slow();
  await signInAsAdmin(page);
  const { id, slug } = await publishedEvent(page, `Relay ${Date.now()}`);
  const { codes } = await issuedOrder(page, slug, 'Rafiq Islam', 3);
  await openDoors(page, id);
  const checkIn = `/admin/events/${id}/check-in`;
  const gateA = await newGatePass(page, checkIn, 'Gate A');
  const gateB = await newGatePass(page, checkIn, 'Gate B');

  const contextA = await browser.newContext();
  const contextB = await browser.newContext();
  const phoneA = await contextA.newPage();
  const phoneB = await contextB.newPage();
  for (const [phone, code] of [
    [phoneA, gateA],
    [phoneB, gateB],
  ] as const) {
    await phone.goto(`/door#code=${code}`);
    await expect(phone.locator('main[data-offline-list]')).toHaveAttribute(
      'data-offline-list',
      '3',
    );
    await expect(phone.getByTestId('door-relay')).toHaveAttribute('data-state', 'live');
  }

  // 1. The ping is cut on Gate A, and its scans cannot reach the server:
  // only the relay can tell it what Gate B just did.
  await phoneA.route('**/door/api/status**', (route) => route.abort());
  await phoneA.route('**/door/api/scans', (route) => route.abort());
  await expect(await typeCode(phoneB, codes[0]!)).toHaveAttribute('data-result', 'admitted');
  const heard = await typeCode(phoneA, codes[0]!);
  await expect(heard).toHaveAttribute('data-offline', 'true');
  await expect(heard).toHaveAttribute('data-result', 'already_in');
  await expect(heard).toContainText('Gate B');
  await dismiss(phoneA);
  await dismiss(phoneB);

  // 2. Our server out of reach for BOTH gates: Gate A's offline admit still
  // reaches Gate B through the relay, phone to phone.
  await phoneB.route('**/door/api/**', (route) => route.abort());
  await phoneA.route('**/door/api/**', (route) => route.abort());
  const offlineAdmit = await typeCode(phoneA, codes[1]!);
  await expect(offlineAdmit).toHaveAttribute('data-result', 'admitted');
  await expect(offlineAdmit).toHaveAttribute('data-offline', 'true');
  await dismiss(phoneA);
  const caught = await typeCode(phoneB, codes[1]!);
  await expect(caught).toHaveAttribute('data-offline', 'true');
  await expect(caught).toHaveAttribute('data-result', 'already_in');
  await expect(caught).toContainText('Gate A');
  await dismiss(phoneB);

  // 3. A ticket nobody used is still welcome at either gate.
  const fresh = await typeCode(phoneB, codes[2]!);
  await expect(fresh).toHaveAttribute('data-result', 'admitted');
  await dismiss(phoneB);

  await contextA.close();
  await contextB.close();
});

/**
 * The relay's front door, without a browser: every bad pass is refused
 * before a room is touched, and a revoked pass stays out.
 */
test.describe('the relay refuses what it should (ADR-058)', () => {
  const EVENT = '6f1c2b8e-3a4d-4c5e-9f60-718293a4b5c6';
  const OTHER_EVENT = '7e2d3c9f-4b5e-4d6f-8a71-829304b5c6d7';
  const ORIGIN = 'http://localhost:3100';
  const ws = (eventId: string) => `${RELAY_URL}/events/${eventId}/ws`;
  const exp = () => Math.floor(Date.now() / 1000) + 3600;
  const gatePass = (passId: string, over: Partial<RelayClaims> = {}) =>
    signRelayPass(
      { v: 1, role: 'gate', eventId: EVENT, passId, gate: 'Gate A', exp: exp(), ...over },
      RELAY_SECRET,
    );
  const serverPass = (eventId = EVENT) =>
    signRelayPass({ v: 1, role: 'server', eventId, exp: exp() }, RELAY_SECRET);
  const join = (
    request: APIRequestContext,
    pass: string | null,
    { eventId = EVENT, origin = ORIGIN } = {},
  ) =>
    request.get(ws(eventId), {
      headers: {
        Upgrade: 'websocket',
        Origin: origin,
        ...(pass === null ? {} : { 'Sec-WebSocket-Protocol': `${RELAY_PROTOCOL}, ${pass}` }),
      },
    });

  test('a phone needs a valid gate pass for this event, from our site', async ({ request }) => {
    const pass = await gatePass(randomUUID());
    expect((await request.get(ws(EVENT))).status()).toBe(426); // not a WebSocket
    expect((await join(request, null)).status()).toBe(401); // no pass
    expect((await join(request, 'not.a-pass')).status()).toBe(401);
    expect((await join(request, pass, { origin: 'https://evil.example' })).status()).toBe(403);
    expect((await join(request, pass, { eventId: OTHER_EVENT })).status()).toBe(401);
    expect((await join(request, await serverPass())).status()).toBe(401); // wrong role
    const expired = await gatePass(randomUUID(), { exp: Math.floor(Date.now() / 1000) - 1 });
    expect((await join(request, expired)).status()).toBe(401);
    const forged = await signRelayPass(
      { v: 1, role: 'gate', eventId: EVENT, passId: randomUUID(), gate: 'Gate A', exp: exp() },
      'another-secret-entirely-not-the-relays-0123456789',
    );
    expect((await join(request, forged)).status()).toBe(401);
  });

  test('only our server may announce, for its own event', async ({ request }) => {
    const announce = (token: string, eventId = EVENT) =>
      request.post(`${RELAY_URL}/events/${eventId}/announce`, {
        headers: { Authorization: `Bearer ${token}` },
        data: { kind: 'revoke', passId: randomUUID() },
      });
    expect((await announce(await gatePass(randomUUID()))).status()).toBe(401);
    expect((await announce(await serverPass(OTHER_EVENT))).status()).toBe(401);
    expect((await announce(await serverPass())).status()).toBe(204);
  });

  test('a revoked pass cannot come back', async ({ request }) => {
    const passId = randomUUID();
    const res = await request.post(`${RELAY_URL}/events/${EVENT}/announce`, {
      headers: { Authorization: `Bearer ${await serverPass()}` },
      data: { kind: 'revoke', passId },
    });
    expect(res.status()).toBe(204);
    const again = await join(request, await gatePass(passId));
    expect(again.status()).toBe(401);
    expect(await again.text()).toBe('revoked');
  });
});

test('a gate back from a long outage re-sends all its claims at once, and stays connected (B-1)', async () => {
  const EVENT = randomUUID();
  const exp = Math.floor(Date.now() / 1000) + 3600;
  const pass = (passId: string, gate: string) =>
    signRelayPass({ v: 1, role: 'gate', eventId: EVENT, passId, gate, exp }, RELAY_SECRET);
  const open = async (token: string) => {
    // Node's WebSocket takes headers (a browser sends Origin itself).
    const init = {
      protocols: [RELAY_PROTOCOL, token],
      headers: { Origin: 'http://localhost:3100' },
    };
    const ws = new WebSocket(
      `${RELAY_URL.replace('http', 'ws')}/events/${EVENT}/ws?after=0`,
      init as never,
    );
    const got: string[] = [];
    ws.onmessage = (e) => got.push(String(e.data));
    await new Promise((resolve, reject) => {
      ws.onopen = resolve;
      ws.onerror = reject;
    });
    return { ws, got };
  };

  const gateA = await open(await pass(randomUUID(), 'Gate A'));
  const claims = Array.from({ length: 120 }, () => ({
    t: 'in',
    ticketId: randomUUID(),
    at: Date.now(),
  }));
  gateA.ws.send(JSON.stringify({ t: 'claims', items: claims }));
  // More than the 50-per-10 s message limit, sent as one: the link stays up.
  await new Promise((r) => setTimeout(r, 500));
  expect(gateA.ws.readyState).toBe(WebSocket.OPEN);

  const gateB = await open(await pass(randomUUID(), 'Gate B'));
  await expect
    .poll(() =>
      gateB.got
        .map((m) => JSON.parse(m) as { t: string; rows?: unknown[] })
        .filter((m) => m.t === 'checkins')
        .reduce((n, m) => n + (m.rows?.length ?? 0), 0),
    )
    .toBe(120);
  gateA.ws.close();
  gateB.ws.close();
});
