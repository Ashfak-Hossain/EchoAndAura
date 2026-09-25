import { expect, test } from '@playwright/test';

// Canvas 6, N1–N4 (plan decision 7). No data needed: the tone and the current
// link depend only on the path. Whether "Get tickets" shows depends on what
// other specs have published meanwhile, so only its either/or is asserted.

test.describe('site chrome (N1–N4)', () => {
  test('the header is charcoal on the home page, light elsewhere, and marks the current page', async ({
    page,
  }) => {
    await page.goto('/');
    const header = page.getByRole('banner');
    const site = page.getByRole('navigation', { name: 'Site', exact: true });
    await expect(header).toHaveAttribute('data-tone', 'dark');
    await expect(site.locator('[aria-current]')).toHaveCount(0);

    // A client-side navigation: the layout persists, so the tone and the
    // current link must follow the path without a server render.
    await site.getByRole('link', { name: 'FAQ', exact: true }).click();
    await expect(page).toHaveURL(/\/faq$/);
    await expect(header).toHaveAttribute('data-tone', 'light');
    await expect(site.getByRole('link', { name: 'FAQ', exact: true })).toHaveAttribute(
      'aria-current',
      'page',
    );
    await expect(site.locator('[aria-current]')).toHaveCount(1);

    await page.goto('/events');
    // exact: "Events" is also a substring of "Past events".
    await expect(site.getByRole('link', { name: 'Events', exact: true })).toHaveAttribute(
      'aria-current',
      'page',
    );

    await header.getByRole('link', { name: 'echoandaura, home' }).click();
    await expect(page).toHaveURL(/\/$/);
    await expect(header).toHaveAttribute('data-tone', 'dark');
    await expect(site.locator('[aria-current]')).toHaveCount(0);
  });

  test('on a phone the links open in a full-screen menu that holds focus', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/faq');
    await expect(page.getByRole('navigation', { name: 'Site', exact: true })).toBeHidden();

    const trigger = page.getByRole('button', { name: 'Open menu' });
    await expect(trigger).toHaveAttribute('aria-expanded', 'false');
    await trigger.click();

    const menu = page.getByRole('dialog', { name: 'Menu' });
    await expect(menu).toBeVisible();
    // The modal makes everything behind it inert, the button included.
    await expect(
      page.getByRole('button', { name: 'Open menu', includeHidden: true }),
    ).toHaveAttribute('aria-expanded', 'true');
    const nav = menu.getByRole('navigation', { name: 'Site', exact: true });
    await expect(nav.getByRole('link')).toHaveText([
      /^Events/,
      /^Past events/,
      /^FAQ/,
      /^Contact/,
      /Sign in|My orders/,
    ]);
    await expect(nav.getByRole('link', { name: 'FAQ', exact: true })).toHaveAttribute(
      'aria-current',
      'page',
    );
    await expect(
      menu
        .getByRole('link', { name: 'Get tickets' })
        .or(
          menu.getByText(
            /Nothing is on sale right now\.|Tickets for the next show are not on sale\./,
          ),
        ),
    ).toBeVisible();

    // Tab cycles inside the menu and never reaches the page behind it. Past
    // the last link, focus touches base-ui's focus guard for a tick before it
    // wraps to the first, so each step waits for focus to settle.
    const focused = () =>
      menu.evaluate((el) => {
        const a = document.activeElement;
        return `${el.contains(a) ? 'in' : 'OUT'}: ${a?.outerHTML.slice(0, 80)}`;
      });
    for (let i = 0; i < 12; i++) {
      await page.keyboard.press('Tab');
      await expect.poll(focused, { message: `after Tab ${i + 1}` }).toMatch(/^in:/);
    }
    await page.keyboard.press('Shift+Tab');
    await expect.poll(focused).toMatch(/^in:/);

    // Esc closes it and hands focus back to the button that opened it.
    await page.keyboard.press('Escape');
    await expect(menu).toBeHidden();
    await expect(trigger).toBeFocused();
    await expect(trigger).toHaveAttribute('aria-expanded', 'false');

    // Following a link closes it too.
    await trigger.click();
    await menu.getByRole('link', { name: 'Past events', exact: true }).click();
    await expect(page).toHaveURL(/\/archive$/);
    await expect(menu).toBeHidden();

    // So does widening past lg, where the desktop links take over.
    await trigger.click();
    await expect(menu).toBeVisible();
    await page.setViewportSize({ width: 1280, height: 800 });
    await expect(menu).toBeHidden();
    await expect(page.getByRole('navigation', { name: 'Site', exact: true })).toBeVisible();
  });
});
