import { expect, test, type Page } from './test';

// ADR-048: the bot check end to end, on Find my order (the one protected
// form that needs no event or account). The e2e server runs APP_ENV=test,
// so the real widget script loads from Cloudflare on the always-pass test
// site key and the server asks the real siteverify — this spec needs
// internet. The auto CSP guard (./test) fails it if the policy blocks the
// widget's script or iframe.

// The right shape (or the form refuses it before the bot check runs) but
// no such order: "No order matches" means the check let the submit through.
const REFERENCE = 'EA-7K3M9Q';
const PHONE = '1999999999';
const NO_MATCH = /no order matches/i;
// Spelled out, like every spec's copy: importing src/lib/human-check would
// drag next/headers into the test runner. Matches its HUMAN_CHECK_FAILED.
const BOT_REFUSAL = /couldn't confirm you're not a bot/i;
// src/lib/turnstile-config.ts: the test site key's token, and its field.
const DUMMY_TOKEN = 'XXXX.DUMMY.TOKEN.XXXX';

function token(page: Page) {
  return page.locator('form input[name="cf-turnstile-response"]');
}

async function fillAndSubmit(page: Page) {
  await page.getByLabel('Order reference').fill(REFERENCE);
  await page.getByLabel(/mobile number/i).fill(PHONE);
  await page.getByRole('button', { name: /find my order/i }).click();
}

test.describe('bot check (ADR-048)', () => {
  test('the widget hands the form a token and the submit gets through', async ({ page }) => {
    await page.goto('/orders/find');
    // The widget adds the hidden input inside the form, filled once solved.
    await expect(token(page)).toHaveValue(DUMMY_TOKEN, { timeout: 15_000 });
    await fillAndSubmit(page);
    await expect(page.getByRole('alert').filter({ hasText: NO_MATCH })).toBeVisible();
    await expect(page.getByText(BOT_REFUSAL)).toHaveCount(0);
  });

  test('a submit before the widget has solved waits for the token instead of failing', async ({
    page,
  }) => {
    // Hold the script back so the click surely comes first.
    let releaseScript = () => {};
    const scriptHeld = new Promise<void>((resolve) => (releaseScript = resolve));
    await page.route('https://challenges.cloudflare.com/turnstile/**', async (route) => {
      await scriptHeld;
      await route.continue();
    });
    await page.goto('/orders/find');
    await fillAndSubmit(page);
    await expect(
      page.getByRole('status').filter({ hasText: /checking you are not a bot/i }),
    ).toBeVisible();

    releaseScript();
    await expect(page.getByRole('alert').filter({ hasText: NO_MATCH })).toBeVisible({
      timeout: 15_000,
    });
    await expect(page.getByText(BOT_REFUSAL)).toHaveCount(0);
  });

  test('a post without a token is refused and the typed values are kept', async ({ page }) => {
    // The script never loads (a content blocker, or a bot that skips it),
    // so the form posts with no token field at all.
    await page.route('https://challenges.cloudflare.com/**', (route) => route.abort());
    await page.goto('/orders/find');
    await expect(page.getByText(/the bot check could not load/i)).toBeVisible();
    await expect(token(page)).toHaveCount(0);

    await fillAndSubmit(page);
    await expect(page.getByRole('alert').filter({ hasText: BOT_REFUSAL })).toBeVisible();
    await expect(page.getByLabel('Order reference')).toHaveValue(REFERENCE);
    await expect(page.getByLabel(/mobile number/i)).toHaveValue(PHONE);
  });

  test('a script that failed to load is tried again after the refusal, without a refresh', async ({
    page,
  }) => {
    // One dropped request (a flaky mobile connection), then the network is back.
    let dropScript = true;
    await page.route('https://challenges.cloudflare.com/turnstile/**', (route) =>
      dropScript ? route.abort() : route.continue(),
    );
    await page.goto('/orders/find');
    await expect(page.getByText(/the bot check could not load/i)).toBeVisible();
    dropScript = false;

    await fillAndSubmit(page);
    await expect(page.getByRole('alert').filter({ hasText: BOT_REFUSAL })).toBeVisible();
    // The server's answer makes the widget load again; the typed values stay.
    await expect(token(page)).toHaveValue(DUMMY_TOKEN, { timeout: 15_000 });
    await expect(page.getByText(/the bot check could not load/i)).toHaveCount(0);
    await expect(page.getByLabel('Order reference')).toHaveValue(REFERENCE);
    await page.getByRole('button', { name: /find my order/i }).click();
    await expect(page.getByRole('alert').filter({ hasText: NO_MATCH })).toBeVisible();
  });

  test('after a refused submit the widget resets and the next submit gets through', async ({
    page,
  }) => {
    await page.goto('/orders/find');
    await expect(token(page)).toHaveValue(DUMMY_TOKEN, { timeout: 15_000 });
    // Spend the token as if it had been used: an empty one is refused
    // before Cloudflare is asked.
    await token(page).evaluate((el: HTMLInputElement) => {
      el.value = '';
    });
    await fillAndSubmit(page);
    await expect(page.getByRole('alert').filter({ hasText: BOT_REFUSAL })).toBeVisible();

    // The server's answer resets the widget, which solves again. Waiting for
    // the token proves it: we emptied the old one.
    await expect(token(page)).toHaveValue(DUMMY_TOKEN, { timeout: 15_000 });
    await page.getByRole('button', { name: /find my order/i }).click();
    await expect(page.getByRole('alert').filter({ hasText: NO_MATCH })).toBeVisible();
  });
});
