import { test, expect } from '@playwright/test';

test('ticket tour renders live excerpts and checked type information', async ({ page }) => {
  await page.goto('/docs/tours/buy-a-ticket/');
  await expect(page.getByRole('heading', { name: 'Buy a ticket', exact: true })).toBeVisible();
  await expect(page.locator('pre').filter({ hasText: 'Number.isInteger(quantity)' })).toHaveCount(
    1,
  );
  await expect(page.locator('pre').filter({ hasText: 'return rows.length === 1' })).toHaveCount(1);
  await expect(page.locator('.twoslash')).not.toHaveCount(0);
  const typeTrigger = page
    .locator('button.twoslash-hover')
    .filter({ hasText: 'isValidOrderQuantity' })
    .first();
  await typeTrigger.focus();
  await page.keyboard.press('Enter');
  await expect(page.locator('.fd-twoslash-popover')).toBeVisible();
  await expect(page.locator('.fd-twoslash-popover')).toContainText('boolean');
  await page.keyboard.press('Escape');
  await expect(page.locator('.fd-twoslash-popover')).not.toBeVisible();
  await expect(page.getByRole('link', { name: 'email dispatcher', exact: true })).toHaveAttribute(
    'href',
    /\/src\/server\/email\/dispatch.ts$/,
  );
  // Five numbered steps, the rules they rely on, then where to read next.
  await expect(page.locator('.fd-step')).toHaveCount(5);
  await expect(page.getByText('Rule: prices never come from the browser')).toBeVisible();
  await expect(page.getByRole('link', { name: /Order states/ }).last()).toHaveAttribute(
    'href',
    '/docs/reference/order-states/',
  );
  await expect(page.getByRole('link', { name: "View this page's source" })).toHaveAttribute(
    'href',
    /\/blob\/[a-f0-9]{40}\/docs-site\/content\/docs\/tours\/buy-a-ticket\.mdx$/,
  );
  // The pre-rendered sequence diagram loads, in the theme the page shows.
  const diagram = page.locator('figure.diagram').first();
  const loaded = (selector: string) =>
    diagram.locator(selector).evaluate((img: HTMLImageElement) => img.complete && img.naturalWidth);
  await expect(diagram.locator('.diagram-light img')).toBeVisible();
  await expect.poll(() => loaded('.diagram-light img')).toBeGreaterThan(0);
  await page.screenshot({ path: test.info().outputPath('tour-light.png'), fullPage: true });
  await page.evaluate(() => localStorage.setItem('theme', 'dark'));
  await page.reload();
  await expect(diagram.locator('.diagram-dark img')).toBeVisible();
  await expect(diagram.locator('.diagram-light img')).toBeHidden();
  await expect.poll(() => loaded('.diagram-dark img')).toBeGreaterThan(0);
});

test('last ticket walkthrough supports either winner, keyboard, reset and narrow themes', async ({
  page,
}) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('/docs/concepts/last-ticket/');
  const race = page.getByRole('region', { name: 'Two buyers race for the last ticket' });
  const next = race.getByRole('button', { name: 'Next step' });
  const previous = race.getByRole('button', { name: 'Previous step' });
  for (const buyer of ['A', 'B']) {
    await race.getByRole('button', { name: `Buyer ${buyer}`, exact: true }).click();
    await expect(previous).toBeDisabled();
    await next.focus();
    await page.keyboard.press('Enter');
    await expect(
      race.getByRole('heading', { name: `Buyer ${buyer} reserves the ticket` }),
    ).toBeVisible();
    await expect(
      race.getByText("Counters show the winner's uncommitted view.", { exact: false }),
    ).toBeVisible();
    await next.click();
    await expect(
      race.getByRole('heading', { name: `Buyer ${buyer} commits the order` }),
    ).toBeVisible();
    await next.click();
    await expect(
      race.getByRole('heading', { name: `Buyer ${buyer === 'A' ? 'B' : 'A'} is refused` }),
    ).toBeVisible();
    await expect(next).toBeDisabled();
    await previous.click();
    await expect(next).toBeEnabled();
    await race.getByRole('button', { name: 'Reset', exact: true }).click();
    await expect(previous).toBeDisabled();
  }
  await page.emulateMedia({ reducedMotion: 'reduce' });
  for (const theme of ['light', 'dark']) {
    await page.evaluate((value) => localStorage.setItem('theme', value), theme);
    for (const width of [1280, 390, 320]) {
      await page.setViewportSize({ width, height: 900 });
      await page.goto('/docs/concepts/last-ticket/');
      await expect
        .poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth))
        .toBe(true);
      await next.click();
      await race.scrollIntoViewIfNeeded();
      await page.screenshot({
        path: test.info().outputPath(`race-${theme}-${width}.png`),
        fullPage: true,
      });
      for (const route of ['tours/buy-a-ticket', 'reference/order-states']) {
        await page.goto(`/docs/${route}/`);
        await expect
          .poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth))
          .toBe(true);
      }
      await page.goto('/docs/tours/buy-a-ticket/');
      await page.screenshot({ path: test.info().outputPath(`tour-${theme}-${width}.png`) });
    }
  }
  expect(errors).toEqual([]);
});

test('glossary terms can be linked to directly and found by search', async ({ page }) => {
  await page.goto('/docs/reference/glossary/#paisa');
  await expect(page.locator('h2#paisa')).toBeInViewport();
  await page
    .getByRole('button', { name: /Search/ })
    .first()
    .click();
  const dialog = page.getByRole('dialog');
  await dialog.getByRole('combobox').fill('idempotent');
  await expect(dialog.getByRole('option', { name: /Idempotent/ }).first()).toBeVisible();
  await page.keyboard.press('Escape');
  await page.goto('/docs/run-it-locally/');
  await expect(page.locator('.fd-step')).toHaveCount(4);
  await expect(page.getByRole('heading', { name: 'Take an order through it' })).toBeVisible();
});

test('paisa calculator shows the floating drift and the exact paisa total', async ({ page }) => {
  await page.goto('/docs/concepts/money-in-paisa/');
  const calc = page.locator('.paisa-calc');
  const total = calc.getByRole('row', { name: /^Total/ });
  // Default: ৳19.99 × 3 with DHAKA15, the example the page explains.
  await expect(total).toContainText('50.9745');
  await expect(total).toContainText('not a whole paisa');
  await expect(total).toContainText('5,100');
  await expect(total).toContainText('৳51.00');
  await calc.getByRole('button', { name: /DHAKA15/ }).click();
  await expect(total).toContainText('5,997');
  await calc.getByRole('button', { name: '৳1,200' }).click();
  await calc.getByRole('button', { name: 'One ticket fewer' }).click();
  await expect(total).toContainText('240,000');
  await expect(total).not.toContainText('not a whole paisa');
  await page.setViewportSize({ width: 320, height: 800 });
  await expect
    .poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth))
    .toBe(true);
});

test('after-commit explorer shows what each placement does under each failure', async ({
  page,
}) => {
  await page.goto('/docs/concepts/work-after-commit/');
  const box = page.locator('.after-commit');
  const outcome = box.locator('.after-commit-outcome');
  // Default: the app's way, nothing failing.
  await expect(outcome).toHaveAttribute('data-good', 'true');
  await expect(outcome).toContainText('Sent by the worker');
  await box.getByRole('button', { name: 'Inside the transaction' }).click();
  await expect(box.getByRole('button', { name: 'The queue is unreachable' })).toBeDisabled();
  await box.getByRole('button', { name: 'The audit insert fails' }).click();
  await expect(outcome).toHaveAttribute('data-good', 'false');
  await expect(outcome).toContainText('an order that does not exist');
  await box.getByRole('button', { name: 'After the commit' }).click();
  await expect(outcome).toHaveAttribute('data-good', 'true');
  await expect(outcome).toContainText('Never queued');
  await box.getByRole('button', { name: 'The email service is down' }).click();
  await expect(outcome).toContainText('Retrying');
  await expect(box.locator('[data-status="retry"]')).toHaveCount(1);
  await page.setViewportSize({ width: 320, height: 800 });
  await expect
    .poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth))
    .toBe(true);
});

test('gate tour shows the real check-in and offline code, and its diagram', async ({ page }) => {
  await page.goto('/docs/tours/admit-a-guest/');
  await expect(
    page.getByRole('heading', { name: 'Admit a guest at the gate', exact: true }),
  ).toBeVisible();
  await expect(page.locator('.fd-step')).toHaveCount(6);
  await expect(page.locator('pre').filter({ hasText: 'isNull(tickets.checkedInAt)' })).toHaveCount(
    1,
  );
  await expect(page.locator('pre').filter({ hasText: 'export function judgeOffline' })).toHaveCount(
    1,
  );
  const img = page.locator('figure.diagram .diagram-light img');
  await expect(img).toBeVisible();
  await expect
    .poll(() => img.evaluate((el: HTMLImageElement) => el.complete && el.naturalWidth))
    .toBeGreaterThan(0);
});

test('gate flow: online agreement, an offline double entry, and a relayed refusal', async ({
  page,
}) => {
  await page.goto('/docs/tours/admit-a-guest/');
  const flow = page.locator('.gate-flow');
  const gate = (id: 'A' | 'B') => flow.getByRole('region', { name: `Gate ${id}` });
  const answer = (id: 'A' | 'B') => gate(id).locator('.gate-answer');
  const server = flow.locator('.gate-server');
  const reset = () => flow.getByRole('button', { name: 'Reset' }).click();

  // 1. Both online: A admits, B is refused by the server.
  await flow.getByRole('button', { name: "Scan Mina's ticket at Gate A" }).click();
  await flow.getByRole('button', { name: "Scan Mina's ticket at Gate B" }).click();
  await expect(answer('A')).toHaveText('Admit');
  await expect(answer('B')).toContainText('Already in: Gate A');

  // 2. A offline admits, B admits online, A's sync records a double entry.
  await reset();
  await flow.getByRole('button', { name: "Drop Gate A's signal" }).click();
  await flow.getByRole('button', { name: "Scan Mina's ticket at Gate A" }).click();
  await expect(answer('A')).toContainText('offline');
  await flow.getByRole('button', { name: "Scan Mina's ticket at Gate B" }).click();
  await expect(answer('B')).toHaveText('Admit');
  await flow.getByRole('button', { name: "Restore Gate A's signal" }).click();
  await expect(server).toHaveAttribute('data-double', 'true');
  await expect(server).toContainText('Gate B');

  // 3. B heard via the relay before its signal dropped: refused offline.
  await reset();
  await flow.getByRole('button', { name: "Scan Mina's ticket at Gate A" }).click();
  await flow.getByRole('button', { name: "Drop Gate B's signal" }).click();
  await flow.getByRole('button', { name: "Scan Mina's ticket at Gate B" }).click();
  await expect(answer('B')).toContainText('Already in: Gate A');
  await expect(answer('B')).toContainText('offline');
  await expect(server).toHaveAttribute('data-double', 'false');

  await page.setViewportSize({ width: 320, height: 800 });
  await expect
    .poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth))
    .toBe(true);
});

test('merge-to-production page shows the pipeline, its gates and the real check', async ({
  page,
}) => {
  await page.goto('/docs/infrastructure/from-merge-to-production/');
  await expect(page.locator('.fd-step')).toHaveCount(6);
  await expect(page.locator('pre').filter({ hasText: 'deploymentService.check()' })).toHaveCount(1);
  const img = page.locator('figure.diagram .diagram-light img');
  await expect
    .poll(() => img.evaluate((el: HTMLImageElement) => el.complete && el.naturalWidth))
    .toBeGreaterThan(0);
  await expect(page.getByRole('link', { name: 'From merge to production' }).first()).toBeVisible();
});
