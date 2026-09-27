import { expect, test, type Page } from '@playwright/test';
import {
  issuedOrder,
  newGatePass,
  openDoors,
  publishedEvent,
  signIn,
  typeCode,
} from './door-helpers';

/** The worker controls the page and has a saved copy of it. */
function savedCopy(phone: Page) {
  return phone.evaluate(async () =>
    Boolean(navigator.serviceWorker.controller && (await caches.match('/door'))),
  );
}

test.describe('gate scanner reloads without signal (ADR-035)', () => {
  test('opens the saved copy offline, scans from the list, sends when back, forgets on End session', async ({
    page,
    browser,
  }) => {
    test.slow();
    await signIn(page);
    const { id, slug } = await publishedEvent(page, `Reload ${Date.now()}`);
    const { codes } = await issuedOrder(page, slug, 'Nusrat Jahan', 2);
    await openDoors(page, id);
    const checkInUrl = `/admin/events/${id}/check-in`;
    const gateA = await newGatePass(page, checkInUrl, 'Gate A');
    const gateB = await newGatePass(page, checkInUrl, 'Gate B');

    // Gate A opens its pass with signal: the list comes down, and the page
    // saves a copy of itself — the decoder included.
    const context = await browser.newContext();
    const phone = await context.newPage();
    await phone.goto(`/door#code=${gateA}`);
    await expect(phone.getByText('Gate A', { exact: true })).toBeVisible();
    await expect(phone.locator('main[data-offline-list]')).toHaveAttribute(
      'data-offline-list',
      '2',
    );
    await expect.poll(() => savedCopy(phone), { timeout: 30_000 }).toBe(true);
    expect(
      await phone.evaluate(async () =>
        Boolean(await caches.match('/vendor/zxing_reader-3.1.3.wasm')),
      ),
    ).toBe(true);
    await expect(phone.getByTestId('door-count')).toHaveText('0 / 2 in');

    // Gate B admits the second ticket: a fresh page at Gate A would say 1.
    const phoneB = await (await browser.newContext()).newPage();
    await phoneB.goto(`/door#code=${gateB}`);
    await expect(phoneB.getByText('Gate B', { exact: true })).toBeVisible();
    await expect(await typeCode(phoneB, codes[1]!)).toHaveAttribute('data-result', 'admitted');

    // The signal is gone and the tab reloads (iOS dropped it, or a pull
    // to refresh): the saved copy opens, straight into offline mode.
    await context.setOffline(true);
    await phone.reload();
    await expect(phone.getByText('Gate A', { exact: true })).toBeVisible();
    await expect(phone.getByTestId('door-count')).toHaveText('0 / 2 in');
    const banner = phone.getByTestId('door-offline');
    await expect(banner).toBeVisible();
    await expect(banner).toContainText('answering from the ticket list');
    await expect(banner).toContainText('Counts as of');
    await expect(phone.locator('main[data-offline-list]')).toHaveAttribute(
      'data-offline-list',
      '2',
    );

    // It still answers from the list kept on the phone.
    const admit = await typeCode(phone, codes[0]!);
    await expect(admit).toHaveAttribute('data-result', 'admitted');
    await expect(admit).toHaveAttribute('data-offline', 'true');
    await expect(admit).toContainText('Nusrat Jahan');
    await expect(admit).toBeHidden({ timeout: 5_000 });
    await expect(phone.getByTestId('door-pending')).toHaveText('1 to send');

    // Signal back: the outbox goes out, the counts catch up.
    await context.setOffline(false);
    await expect(phone.getByTestId('door-pending')).toHaveCount(0, { timeout: 30_000 });
    await expect(phone.getByTestId('door-count')).toHaveText('2 / 2 in', { timeout: 20_000 });
    await expect(banner).toHaveCount(0);

    await page.goto(checkInUrl);
    await expect(page.getByTestId('checked-in-count')).toHaveText('2 of 2 checked in');
    await expect(page.getByTestId('offline-conflict-row')).toHaveCount(0);

    // End session: the saved copy (last scans, with names) is deleted, so
    // a reload without signal shows the no-signal page, not the old gate.
    await phone.getByRole('button', { name: 'End session' }).click();
    await phone.getByRole('button', { name: 'Tap again to end' }).click();
    await expect(phone.getByRole('heading', { name: 'Enter the gate code' })).toBeVisible({
      timeout: 20_000,
    });
    await expect
      .poll(() => phone.evaluate(async () => Boolean(await caches.match('/door'))))
      .toBe(false);
    await context.setOffline(true);
    await phone.reload();
    await expect(phone.getByTestId('door-no-signal')).toBeVisible();
    await expect(phone.getByText('Nusrat Jahan')).toHaveCount(0);
  });

  test('the worker script may control /door and is always revalidated', async ({ request }) => {
    const res = await request.get('/door/sw.js');
    expect(res.status()).toBe(200);
    expect(res.headers()['service-worker-allowed']).toBe('/door');
    expect(res.headers()['cache-control']).toContain('no-cache');
    expect(res.headers()['content-type']).toContain('javascript');
  });
});
