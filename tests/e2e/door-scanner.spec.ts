import path from 'node:path';
import { formatInTimeZone } from 'date-fns-tz';
import { expect, test, type Page } from '@playwright/test';

// Requires a seeded admin (pnpm admin:create) and MinIO (docker compose).
const email = process.env.E2E_ADMIN_EMAIL ?? 'admin@example.com';
const password = process.env.E2E_ADMIN_PASSWORD ?? 'correct-horse-battery';
const COVER = path.join(__dirname, 'fixtures', 'cover.png');
const dhaka = (at: Date) => formatInTimeZone(at, 'Asia/Dhaka', "yyyy-MM-dd'T'HH:mm");

async function signIn(page: Page) {
  await page.goto('/admin/login');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill(password);
  await page.getByRole('button', { name: /^sign in$/i }).click();
  await expect(page).toHaveURL(/\/admin$/, { timeout: 20_000 });
}

async function openTab(page: Page, name: 'Details' | 'Cover image' | 'Ticket types' | 'Publish') {
  await page
    .getByRole('navigation', { name: /event sections/i })
    .getByRole('link', { name })
    .click();
}

/** A published event in 2030 with General (৳1,200 × 20). Returns { id, slug }. */
async function publishedEvent(page: Page, title: string) {
  await page.goto('/admin/events/new');
  await page.getByLabel('Title', { exact: true }).fill(title);
  await page.getByLabel('Venue', { exact: true }).fill('ICCB Hall 4, Dhaka');
  await page.getByLabel(/^Starts at/).fill('2030-10-01T19:00');
  await page.getByLabel(/^Registration opens/).fill('2026-01-01T10:00');
  await page.getByRole('button', { name: /create event/i }).click();
  await expect(page).toHaveURL(/\/admin\/events\/[0-9a-f-]{36}\/edit$/);
  const id = page.url().match(/\/admin\/events\/([0-9a-f-]{36})\/edit/)![1]!;
  const slug = await page.getByLabel(/^URL slug/).inputValue();
  await openTab(page, 'Ticket types');
  await page
    .getByRole('link', { name: /add ticket type/i })
    .first()
    .click();
  await page.getByLabel('Name', { exact: true }).fill('General');
  await page.getByLabel(/^Price/).fill('1200');
  await page.getByLabel('Quantity', { exact: true }).fill('20');
  await page.getByRole('button', { name: /add ticket type/i }).click();
  await openTab(page, 'Cover image');
  await page.getByTestId('cover-file').setInputFiles(COVER);
  await expect(page.getByTestId('cover-image')).toBeVisible();
  await openTab(page, 'Publish');
  await page.getByRole('button', { name: /^publish$/i }).click();
  await expect(page.getByTestId('event-status')).toHaveText('published');
  return { id, slug };
}

/** Registers `quantity` tickets, submits a trxID and approves on B8 (ends there). */
async function issuedOrder(page: Page, slug: string, name: string, quantity: number) {
  await page.goto(`/events/${slug}/register`);
  await page.getByRole('radio', { name: /general/i }).check();
  for (let i = 1; i < quantity; i++) {
    await page.getByRole('button', { name: /more tickets/i }).click();
  }
  await page.getByLabel('Full name').fill(name);
  await page.getByLabel('Email address').fill('buyer@example.com');
  await page.getByLabel('Mobile number').fill('1712345678');
  await page.getByLabel(/I agree to the terms/).check();
  await page.getByRole('button', { name: /continue to payment/i }).click();
  await expect(page).toHaveURL(/\/orders\/[0-9a-f-]{36}$/);
  const reference = (await page.getByTestId('order-reference').textContent())!;
  const trxId = `DR${Date.now().toString(36).toUpperCase()}`.slice(0, 10).padEnd(10, 'Z');
  await page.getByLabel(/transaction id \(trxid\)/i).fill(trxId);
  await page.getByLabel('Number you sent from').fill('1712345678');
  await page.getByRole('button', { name: /i have sent the money/i }).click();
  await expect(page.getByText('Checking payment')).toBeVisible();

  await page.goto('/admin/verification');
  await page.getByTestId('queue-row').filter({ hasText: reference }).getByRole('link').click();
  await expect(page).toHaveURL(/\/admin\/orders\/[0-9a-f-]{36}$/);
  await page.getByRole('button', { name: /^approve — /i }).click();
  await page
    .getByRole('alertdialog')
    .getByRole('button', { name: /approve and issue tickets/i })
    .click();
  await expect(page.getByTestId('order-status')).toHaveText('Tickets issued');
  const codes = await page.getByTestId('ticket-row').allTextContents();
  return { orderUrl: page.url(), codes: codes.map((t) => t.match(/TKT-[A-Z2-9]{8}/)![0]) };
}

/** Admin: a new gate pass on the check-in page; returns its code as shown. */
async function newGatePass(page: Page, checkInUrl: string, label: string) {
  await page.goto(checkInUrl);
  const card = page.getByTestId('gate-passes');
  await card.getByLabel('Gate name').fill(label);
  await card.getByRole('button', { name: 'New gate pass' }).click();
  await expect(page).toHaveURL(/\?pass=[0-9a-f-]{36}/);
  const row = card.getByTestId('gate-pass-row').filter({ hasText: label });
  // The pass just made opens by itself: QR + code.
  const code = (await row.getByTestId('gate-pass-code').textContent())!;
  expect(code).toMatch(/^[A-Z2-9]{4}-[A-Z2-9]{4}-[A-Z2-9]{4}$/);
  return code;
}

/** Door phone: type a code, return the full-screen answer. */
async function typeCode(door: Page, code: string) {
  const field = door.getByLabel('Ticket code');
  if (!(await field.isVisible())) await door.getByRole('button', { name: 'Type a code' }).click();
  await field.fill(code.toLowerCase());
  await door.getByRole('button', { name: 'Check' }).click();
  const result = door.getByTestId('door-result');
  await expect(result).toBeVisible();
  return result;
}

async function dismiss(door: Page) {
  const result = door.getByTestId('door-result');
  if ((await result.getAttribute('data-tone')) !== 'green') {
    await result.getByRole('button', { name: 'Next' }).click();
  }
  await expect(result).toBeHidden();
}

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
