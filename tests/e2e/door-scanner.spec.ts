import { expect, test } from '@playwright/test';
import {
  dhaka,
  dismiss,
  issuedOrder,
  newGatePass,
  publishedEvent,
  signIn,
  typeCode,
} from './door-helpers';

test.describe('gate scanner (ADR-030)', () => {
  test('pass, practice, doors open, green / amber / red, search admit, undo, revoke', async ({
    page,
    browser,
  }) => {
    test.slow();
    await signIn(page);
    const { id, slug } = await publishedEvent(page, `Door ${Date.now()}`);
    const { orderUrl, codes } = await issuedOrder(page, slug, 'Nusrat Jahan', 3);
    expect(codes).toHaveLength(3);
    const checkInUrl = `/admin/events/${id}/check-in`;

    const gateA = await newGatePass(page, checkInUrl, 'Gate A');
    const gateB = await newGatePass(page, checkInUrl, 'Gate B');
    await expect(page.getByTestId('gate-pass-row').filter({ hasText: 'Gate A' })).toContainText(
      'Practice until doors open',
    );

    // A door phone opens the pass link; the code leaves the address bar.
    const phoneA = await (await browser.newContext()).newPage();
    await phoneA.goto(`/door#code=${gateA}`);
    await expect(phoneA.getByText('Gate A', { exact: true })).toBeVisible();
    expect(phoneA.url()).not.toContain('#code');
    await expect(phoneA.getByTestId('door-count')).toHaveText('0 / 3 in');

    // Before doors open: practice answers, checks nothing in.
    await expect(phoneA.getByTestId('door-practice')).toBeVisible();
    const practice = await typeCode(phoneA, codes[0]!);
    await expect(practice).toHaveAttribute('data-result', 'practice_ok');
    await expect(practice).toBeHidden({ timeout: 5_000 });
    await expect(phoneA.getByTestId('door-count')).toHaveText('0 / 3 in');

    // The organizer moves the start to an hour ago: doors are open (a pass
    // works until 12 h after the start). An hour AGO, not ahead — a
    // started event never becomes the home-page hero other specs assert on.
    await page.goto(`/admin/events/${id}/edit`);
    await page.getByLabel(/^Starts at/).fill(dhaka(new Date(Date.now() - 60 * 60_000)));
    await page
      .getByLabel(/^Registration closes/)
      .fill(dhaka(new Date(Date.now() - 2 * 60 * 60_000)));
    await page.getByRole('button', { name: /save changes/i }).click();
    await expect(page).toHaveURL(/\?saved=1/);

    await phoneA.reload();
    await expect(phoneA.getByTestId('door-practice')).toHaveCount(0);

    // Green, then amber for a re-read at the same gate…
    const green = await typeCode(phoneA, codes[0]!);
    await expect(green).toHaveAttribute('data-result', 'admitted');
    await expect(green).toContainText('Nusrat Jahan');
    await expect(green).toContainText('Ticket 1 of 3');
    await expect(green).not.toContainText('TKT-');
    await expect(green).toBeHidden({ timeout: 5_000 });
    const amber = await typeCode(phoneA, codes[0]!);
    await expect(amber).toHaveAttribute('data-tone', 'amber');
    await expect(amber).toContainText('AT THIS GATE');
    await dismiss(phoneA);
    await expect(phoneA.getByTestId('door-count')).toHaveText('1 / 3 in');

    // …and red, with where and when, from another gate.
    const phoneB = await (await browser.newContext()).newPage();
    await phoneB.goto('/door');
    await expect(phoneB.getByRole('heading', { name: 'Enter the gate code' })).toBeVisible();
    await phoneB.getByLabel('Gate code').fill('WRNG-CODE-2222');
    await phoneB.getByRole('button', { name: 'Continue' }).click();
    // (Next's route announcer is a role=alert too: match the text.)
    await expect(phoneB.getByText(/That gate code is not active/)).toBeVisible();
    await phoneB.getByLabel('Gate code').fill(gateB.toLowerCase());
    await phoneB.getByRole('button', { name: 'Continue' }).click();
    await expect(phoneB.getByText('Gate B', { exact: true })).toBeVisible();
    const red = await typeCode(phoneB, codes[0]!);
    await expect(red).toHaveAttribute('data-result', 'already_in');
    await expect(red).toContainText(/\d\d:\d\d · Gate A/);
    await dismiss(phoneB);
    const junk = await typeCode(phoneB, 'TKT-ZZZZZZZZ');
    await expect(junk).toHaveAttribute('data-result', 'unknown');
    await dismiss(phoneB);

    // Name search: no phone digits on screen — staff type what the person
    // says, and the server checks them against the buying phone.
    const findAndAdmit = async (digits: string) => {
      await phoneA.getByRole('button', { name: 'Find by name' }).click();
      await phoneA.getByLabel('Name or ticket code').fill('nusrat');
      const results = phoneA.getByRole('region', { name: 'Find by name' }).getByRole('listitem');
      await expect(results).toHaveCount(3);
      await expect(results.filter({ hasText: /In \d\d:\d\d · Gate A/ })).toHaveCount(1);
      await expect(phoneA.getByRole('region', { name: 'Find by name' })).not.toContainText('678');
      await results.filter({ hasText: 'tap to admit' }).first().getByRole('button').click();
      await phoneA.getByLabel('Last 3 digits of the buying phone').fill(digits);
      await phoneA.getByRole('button', { name: 'Check digits and admit' }).click();
      const answer = phoneA.getByTestId('door-result');
      await expect(answer).toBeVisible();
      return answer;
    };
    const mismatch = await findAndAdmit('111');
    await expect(mismatch).toHaveAttribute('data-result', 'phone_mismatch');
    await dismiss(phoneA);
    await expect(phoneA.getByTestId('door-count')).toHaveText('1 / 3 in');
    const searched = await findAndAdmit('678');
    await expect(searched).toHaveAttribute('data-result', 'admitted');
    await expect(searched).toBeHidden({ timeout: 5_000 });
    await expect(phoneA.getByTestId('door-count')).toHaveText('2 / 3 in');

    // The door undoes its own latest admit.
    const recent = phoneA.getByRole('region', { name: 'Last scans at this gate' });
    await recent.getByRole('button', { name: 'Undo' }).first().click();
    await phoneA.getByRole('button', { name: 'Tapped by mistake' }).click();
    await expect(phoneA.getByRole('status')).toContainText('Check-in undone');
    await expect(phoneA.getByTestId('door-count')).toHaveText('1 / 3 in');

    // Admin list: the count, the filter (never printed), the CSV.
    await page.goto(checkInUrl);
    await expect(page.getByTestId('checked-in-count')).toHaveText('1 of 3 checked in');
    await page
      .getByRole('group', { name: 'Show' })
      .first()
      .getByRole('button', { name: 'In' })
      .click();
    await expect(page).toHaveURL(/show=in/);
    await expect(page.getByTestId('check-in-row')).toHaveCount(1);
    await expect(page.getByTestId('check-in-row').first()).toContainText(/\d\d:\d\d · Gate A/);
    await expect(page.getByRole('button', { name: /print list/i })).toBeDisabled();
    const csv = await (await page.request.get(`${checkInUrl}/export.csv?show=in`)).text();
    const lines = csv.split('\r\n').filter(Boolean);
    expect(lines).toHaveLength(2);
    expect(lines[1]).toMatch(
      new RegExp(`${codes[0]},.*,\\d{4}-\\d\\d-\\d\\d \\d\\d:\\d\\d · Gate A$`),
    );

    // B8: the checked-in ticket shows it, cannot be cancelled, and can be undone.
    await page.goto(orderUrl);
    const row = page.getByTestId('ticket-row').filter({ hasText: codes[0]! });
    await expect(row.getByTestId('ticket-checked-in')).toContainText('Gate A');
    await expect(row.getByRole('button', { name: 'Cancel' })).toHaveCount(0);
    await row.getByRole('button', { name: 'Undo check-in' }).click();
    const dialog = page.getByRole('dialog');
    await dialog.getByLabel(/^Reason/).fill('Wrong ticket of the group scanned');
    await dialog.getByRole('button', { name: 'Undo check-in' }).click();
    await expect(page).toHaveURL(/\?undone=TKT-/);
    await expect(row.getByTestId('ticket-checked-in')).toHaveCount(0);
    await expect(row.getByRole('button', { name: 'Cancel' })).toBeVisible();

    // A leaked pass: revoke it and take back what it admitted.
    await expect(await typeCode(phoneA, codes[0]!)).toHaveAttribute('data-result', 'admitted');
    await page.goto(checkInUrl);
    await page
      .getByTestId('gate-pass-row')
      .filter({ hasText: 'Gate A' })
      .getByRole('button', { name: 'Revoke and undo its check-ins' })
      .click();
    await page
      .getByRole('dialog')
      .getByLabel(/^Reason/)
      .fill('Pass link posted in a group');
    await page.getByRole('dialog').getByRole('button', { name: 'Revoke and undo' }).click();
    await expect(page.getByRole('status').first()).toContainText('1 check-in was undone');
    await expect(page.getByTestId('checked-in-count')).toHaveText('0 of 3 checked in');
    await phoneA.reload();
    await expect(phoneA.getByRole('heading', { name: 'Enter the gate code' })).toBeVisible();

    // A door pass is not an admin session.
    await phoneB.goto('/admin');
    await expect(phoneB).toHaveURL(/\/admin\/login/);
    const cookies = await phoneB.context().cookies();
    expect(cookies.find((c) => c.name === 'door_pass')).toMatchObject({
      path: '/door',
      httpOnly: true,
      sameSite: 'Lax',
    });
  });

  test('the door API refuses cross-origin writes and a missing pass', async ({
    request,
    baseURL,
  }) => {
    const scan = { scans: [{ scanId: crypto.randomUUID(), input: 'TKT-ZZZZZZZZ', method: 'qr' }] };
    const foreign = await request.post('/door/api/scans', {
      data: scan,
      headers: { Origin: 'https://evil.example' },
    });
    expect(foreign.status()).toBe(403);
    const noPass = await request.post('/door/api/scans', {
      data: scan,
      headers: { Origin: new URL(baseURL!).origin },
    });
    expect(noPass.status()).toBe(401);
    const status = await request.get('/door/api/status');
    expect(status.status()).toBe(401);
    expect(status.headers()['cache-control']).toContain('no-store');
  });
});
