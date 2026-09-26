import { expect, test } from '@playwright/test';
import {
  dismiss,
  issuedOrder,
  newGatePass,
  openDoors,
  publishedEvent,
  signIn,
  typeCode,
} from './door-helpers';

test.describe('gate scanner offline (ADR-034)', () => {
  test('answers from the list without signal, sends the outbox, and shows the double entry', async ({
    page,
    browser,
  }) => {
    test.slow();
    await signIn(page);
    const { id, slug } = await publishedEvent(page, `Offline ${Date.now()}`);
    const { codes } = await issuedOrder(page, slug, 'Tahmina Akter', 3);
    await openDoors(page, id);
    const checkInUrl = `/admin/events/${id}/check-in`;
    const gateA = await newGatePass(page, checkInUrl, 'Gate A');
    const gateB = await newGatePass(page, checkInUrl, 'Gate B');

    // Gate A opens its pass with signal: the ticket list comes down.
    const contextA = await browser.newContext();
    const phoneA = await contextA.newPage();
    await phoneA.goto(`/door#code=${gateA}`);
    await expect(phoneA.getByText('Gate A', { exact: true })).toBeVisible();
    await expect(phoneA.locator('main[data-offline-list]')).toHaveAttribute(
      'data-offline-list',
      '3',
    );
    // Hashed codes and names only — never a ticket code or the buyer's phone.
    const listJson = await (await phoneA.request.get('/door/api/list')).text();
    expect(listJson).toContain('Tahmina Akter');
    expect(listJson).not.toContain('TKT-');
    expect(listJson).not.toContain('1712345678');
    const phoneB = await (await browser.newContext()).newPage();
    await phoneB.goto(`/door#code=${gateB}`);
    await expect(phoneB.getByText('Gate B', { exact: true })).toBeVisible();

    // The signal drops at Gate A. It still admits — marked offline.
    await contextA.setOffline(true);
    const admit = await typeCode(phoneA, codes[0]!);
    await expect(admit).toHaveAttribute('data-result', 'admitted');
    await expect(admit).toHaveAttribute('data-offline', 'true');
    await expect(admit).toContainText('Tahmina Akter');
    await expect(admit).toContainText('Offline');
    await expect(admit).toBeHidden({ timeout: 5_000 });
    await expect(phoneA.getByTestId('door-offline')).toBeVisible();
    await expect(phoneA.getByTestId('door-pending')).toHaveText('1 to send');

    // The same ticket again: this phone knows it let them in a moment ago.
    const again = await typeCode(phoneA, codes[0]!);
    await expect(again).toHaveAttribute('data-tone', 'amber');
    await expect(again).toContainText('AT THIS GATE');
    await dismiss(phoneA);

    // Not on the list: offline cannot tell another event from a fake.
    const junk = await typeCode(phoneA, 'TKT-ZZZZZZZZ');
    await expect(junk).toHaveAttribute('data-result', 'unknown');
    await expect(junk).toContainText('NOT ON THIS LIST');
    await dismiss(phoneA);

    // A mis-tap, undone before it was ever sent.
    await expect(await typeCode(phoneA, codes[1]!)).toHaveAttribute('data-result', 'admitted');
    await expect(phoneA.getByTestId('door-result')).toBeHidden({ timeout: 5_000 });
    const recent = phoneA.getByRole('region', { name: 'Last scans at this gate' });
    await recent.getByRole('button', { name: 'Undo' }).first().click();
    await phoneA.getByRole('button', { name: 'Tapped by mistake' }).click();
    await expect(phoneA.getByRole('status').filter({ hasText: 'Check-in undone' })).toBeVisible();
    await expect(recent).toContainText('Undone · offline, not sent yet');

    // Name search works from the list, but cannot admit without signal.
    await phoneA.getByRole('button', { name: 'Find by name' }).click();
    await phoneA.getByLabel('Name or ticket code').fill('tahmina');
    const region = phoneA.getByRole('region', { name: 'Find by name' });
    await expect(phoneA.getByTestId('door-search-offline')).toBeVisible();
    await expect(region.getByRole('listitem')).toHaveCount(3);
    await expect(region.getByRole('button', { disabled: false, name: /Tahmina/ })).toHaveCount(0);
    await region.getByRole('button', { name: 'Close' }).click();

    // Meanwhile Gate B (online) admits the third ticket; Gate A's list does
    // not know, so its offline admit of the same ticket is a double entry.
    await expect(await typeCode(phoneB, codes[2]!)).toHaveAttribute('data-result', 'admitted');
    await expect(await typeCode(phoneA, codes[2]!)).toHaveAttribute('data-offline', 'true');
    await expect(phoneA.getByTestId('door-result')).toBeHidden({ timeout: 5_000 });

    // Signal is back: the outbox goes out by itself.
    await contextA.setOffline(false);
    await expect(phoneA.getByTestId('door-pending')).toHaveCount(0, { timeout: 30_000 });
    await expect(phoneA.getByTestId('door-online')).toHaveText('Online');
    await expect(phoneA.getByTestId('door-offline')).toHaveCount(0);

    // The organizer sees what happened: two in, one double entry.
    await page.goto(checkInUrl);
    await expect(page.getByTestId('checked-in-count')).toHaveText('2 of 3 checked in');
    const conflicts = page.getByTestId('offline-conflict-row');
    await expect(conflicts).toHaveCount(1);
    await expect(conflicts.first()).toContainText('Tahmina Akter');
    await expect(conflicts.first()).toContainText(/In first \d\d:\d\d · Gate B/);
    await expect(conflicts.first()).toContainText(/admitted offline \d\d:\d\d · Gate A/);
    await expect(page.getByTestId('gate-pass-row').filter({ hasText: 'Gate A' })).toContainText(
      /\d+ offline/,
    );

    // Offline again, a scan, then End session: it warns before losing it,
    // and sends it first once the signal is back.
    await contextA.setOffline(true);
    // Synced, maybe re-listed since: this gate still knows it let them in.
    const remembered = await typeCode(phoneA, codes[0]!);
    await expect(remembered).toHaveAttribute('data-result', 'already_in');
    await expect(remembered).toHaveAttribute('data-offline', 'true');
    await dismiss(phoneA);
    await expect(await typeCode(phoneA, codes[1]!)).toHaveAttribute('data-result', 'admitted');
    await expect(phoneA.getByTestId('door-result')).toBeHidden({ timeout: 5_000 });
    await phoneA.getByRole('button', { name: 'End session' }).click();
    await expect(
      phoneA.getByRole('button', { name: /2 not sent — tap to end anyway/ }),
    ).toBeVisible();
    await contextA.setOffline(false);
    await phoneA.getByRole('button', { name: /tap to end anyway/ }).click();
    // It sends the outbox first (waiting for a send already in flight).
    await expect(phoneA.getByRole('heading', { name: 'Enter the gate code' })).toBeVisible({
      timeout: 20_000,
    });

    await page.goto(checkInUrl);
    await expect(page.getByTestId('checked-in-count')).toHaveText('3 of 3 checked in');
  });

  test('the offline list needs a gate pass', async ({ request }) => {
    const res = await request.get('/door/api/list');
    expect(res.status()).toBe(401);
    expect(res.headers()['cache-control']).toContain('no-store');
  });
});
