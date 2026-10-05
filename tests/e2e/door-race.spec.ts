import { expect, test } from './test';
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
 * ADR-053 "race both": a read the phone's own list would admit waits at
 * most 0.4 s for the server, then the phone admits and checks behind them;
 * a refusal arriving after raises "server disagrees", and the answer is
 * recorded. Gates share check-ins through the status ping.
 */
test('race both: early admit, server disagrees, gates share check-ins', async ({
  page,
  browser,
}) => {
  test.slow();
  await signInAsAdmin(page);
  const { id, slug } = await publishedEvent(page, `Race ${Date.now()}`);
  const { codes } = await issuedOrder(page, slug, 'Farhana Akter', 3);
  await openDoors(page, id);
  const checkIn = `/admin/events/${id}/check-in`;
  const gateA = await newGatePass(page, checkIn, 'Gate A');
  const gateB = await newGatePass(page, checkIn, 'Gate B');

  const contextA = await browser.newContext();
  // Gate A has no relay (ADR-058) in this test: it learns of other gates
  // only by the status ping, which step 2 cuts. door-relay.spec.ts covers
  // the relay itself.
  await contextA.routeWebSocket(/\/events\/[0-9a-f-]+\/ws/, (ws) => ws.close());
  const phoneA = await contextA.newPage();
  await phoneA.goto(`/door#code=${gateA}`);
  await expect(phoneA.locator('main[data-offline-list]')).toHaveAttribute('data-offline-list', '3');
  const phoneB = await (await browser.newContext()).newPage();
  await phoneB.goto(`/door#code=${gateB}`);
  await expect(phoneB.getByTestId('door-count')).toHaveText('0 / 3 in');

  // A slow server: every scan answer from Gate A's phone arrives 2 s late.
  await phoneA.route('**/door/api/scans', async (route) => {
    await new Promise((resolve) => setTimeout(resolve, 2_000));
    await route.continue();
  });

  // 1. The list says admit: green well before the server could answer…
  const field = phoneA.getByLabel('Ticket code');
  await phoneA.getByRole('button', { name: 'Type a code' }).click();
  await field.fill(codes[0]!);
  const askedAt = Date.now();
  await phoneA.getByRole('button', { name: 'Check' }).click();
  const early = phoneA.getByTestId('door-result');
  await expect(early).toHaveAttribute('data-result', 'admitted', { timeout: 1_500 });
  expect(Date.now() - askedAt).toBeLessThan(1_800);
  await expect(early).toContainText('Farhana Akter');
  // …and the server confirms behind it: no alert, the count moves.
  await expect(phoneA.getByTestId('door-count')).toHaveText('1 / 3 in', { timeout: 10_000 });
  await expect(phoneA.getByTestId('door-disagree')).toHaveCount(0);

  // 2. Gate A hears nothing from the other gates (its pings are cut), so
  // its list still says ticket 2 is free when Gate B lets it in.
  await phoneA.route('**/door/api/status**', (route) => route.abort());
  await expect(await typeCode(phoneB, codes[1]!)).toHaveAttribute('data-result', 'admitted');
  const stale = await typeCode(phoneA, codes[1]!);
  await expect(stale).toHaveAttribute('data-result', 'admitted'); // early, from the list
  const alert = phoneA.getByTestId('door-disagree');
  await expect(alert).toBeVisible({ timeout: 10_000 });
  await expect(alert).toHaveAttribute('data-result', 'already_in');
  await expect(alert).toContainText('Gate B');
  await alert.getByRole('button', { name: 'Turned them away' }).click();
  await expect(alert).toBeHidden();

  await page.goto(checkIn);
  const row = page.getByTestId('race-decision-row');
  await expect(row).toHaveCount(1);
  await expect(row).toContainText('Farhana Akter');
  await expect(row).toContainText('Turned away');
  await expect(row).toContainText(/In first \d{1,2}:\d\d [AP]M · Gate B/);
  // Neither answer checks anyone in: Gate B's one stands.
  await expect(page.getByTestId('checked-in-count')).toHaveText('2 of 3 checked in');

  // 3. Pings back: Gate B's next check-in reaches Gate A within a ping or
  // two — so even without signal afterwards, Gate A refuses that ticket.
  await phoneA.unroute('**/door/api/status**');
  await phoneA.unroute('**/door/api/scans');
  await expect(await typeCode(phoneB, codes[2]!)).toHaveAttribute('data-result', 'admitted');
  await phoneA.waitForTimeout(12_000); // two status pings at most
  await contextA.setOffline(true);
  const shared = await typeCode(phoneA, codes[2]!);
  await expect(shared).toHaveAttribute('data-offline', 'true', { timeout: 10_000 });
  await expect(shared).toHaveAttribute('data-result', 'already_in');
  await expect(shared).toContainText('Gate B');
  await dismiss(phoneA);
});
