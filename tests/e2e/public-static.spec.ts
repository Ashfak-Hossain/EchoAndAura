import { expect, test } from './test';

// A7: the static pages. No data needed — they read only the environment.
const PAGES = [
  { path: '/about', heading: /small rooms, real sound/i },
  { path: '/faq', heading: /questions people ask/i },
  { path: '/terms', heading: /terms of sale/i },
  { path: '/privacy', heading: /privacy policy/i },
  { path: '/refund', heading: /refund policy/i },
  { path: '/contact', heading: /message the organizer/i },
];

test.describe('static pages (A7)', () => {
  test('every page responds with its heading and is reachable from the footer', async ({
    page,
  }) => {
    for (const { path, heading } of PAGES) {
      const res = await page.goto(path);
      expect(res?.status(), path).toBe(200);
      await expect(page.getByRole('heading', { level: 1, name: heading })).toBeVisible();
    }
    // Canvas 6 (N12): the footer groups its links into named navs. "Refund
    // policy" is under both Help and Legal, so each link is looked up in one.
    await page.goto('/');
    const footer = page.getByRole('contentinfo');
    const groups: [string, [string, string][]][] = [
      [
        'About',
        [
          ['About', '/about'],
          ['Contact', '/contact'],
        ],
      ],
      [
        'Help',
        [
          ['FAQ', '/faq'],
          ['Refund policy', '/refund'],
        ],
      ],
      [
        'Legal',
        [
          ['Terms of sale', '/terms'],
          ['Privacy policy', '/privacy'],
          ['Refund policy', '/refund'],
        ],
      ],
    ];
    for (const [nav, links] of groups) {
      const group = footer.getByRole('navigation', { name: nav, exact: true });
      for (const [label, href] of links) {
        await expect(group.getByRole('link', { name: label, exact: true })).toHaveAttribute(
          'href',
          href,
        );
      }
    }
  });

  test('FAQ: one answer open at a time, and a shared anchor opens its answer', async ({ page }) => {
    await page.goto('/faq');
    const first = page.locator('details#when-do-tickets-arrive');
    const second = page.locator('details#wrong-trxid');
    await expect(first).not.toHaveAttribute('open', '');
    await first.locator('summary').click();
    await expect(first).toHaveAttribute('open', '');
    await second.locator('summary').click();
    await expect(second).toHaveAttribute('open', '');
    // Native exclusive accordion (`name="faq"`): opening the second closed the first.
    await expect(first).not.toHaveAttribute('open', '');

    await page.goto('/faq#someone-else');
    await expect(page.locator('details#someone-else')).toHaveAttribute('open', '');
    await expect(page.locator('details#someone-else')).toContainText(
      /change it on the ticket page/i,
    );
  });

  test('policies: switcher, table of contents, anchors, print (Canvas 5)', async ({ page }) => {
    await page.goto('/terms');
    const switcher = page.getByRole('navigation', { name: 'Policies' });
    await expect(switcher.getByRole('link', { name: 'Terms' })).toHaveAttribute(
      'aria-current',
      'page',
    );
    await expect(page.getByRole('heading', { name: 'The short version' })).toBeVisible();
    await expect(page.getByRole('note')).toHaveCount(4);

    // Desktop: the sticky table of contents jumps to a section.
    const toc = page.getByRole('complementary').getByRole('navigation', { name: 'On this page' });
    await toc.getByRole('link', { name: /Names and transfers/ }).click();
    await expect(page).toHaveURL(/\/terms#names-and-transfers$/);
    await expect(page.locator('section#names-and-transfers')).toBeInViewport();
    await expect(
      page.locator('section#names-and-transfers').getByRole('note').first(),
    ).toContainText('Names lock 5 days before the event');

    // Printed: the prose alone, headed by where it came from.
    await page.emulateMedia({ media: 'print' });
    await expect(switcher).toBeHidden();
    await expect(toc).toBeHidden();
    await expect(page.getByText(/^echoandaura · .+\/terms$/)).toBeVisible();
    await page.emulateMedia({ media: 'screen' });

    await switcher.getByRole('link', { name: 'Privacy' }).click();
    await expect(page).toHaveURL(/\/privacy$/);
    await expect(
      page.getByRole('navigation', { name: 'Policies' }).getByRole('link', { name: 'Privacy' }),
    ).toHaveAttribute('aria-current', 'page');
    await expect(page.getByRole('table')).toContainText('Never shown');
  });

  test('policies on a phone: the table of contents is a collapsed list', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/refund');
    const toc = page.locator('details').filter({ hasText: 'On this page' });
    await expect(toc).not.toHaveAttribute('open', '');
    await toc.locator('summary').click();
    await toc.getByRole('link', { name: /If the event is cancelled/ }).click();
    await expect(page).toHaveURL(/#event-cancelled$/);
  });

  // A short desktop window: a 1366×768 laptop minus the browser's toolbars,
  // or a taller screen zoomed in. The list used to stop sticking below
  // 704 px and scrolled out of reach halfway down the page.
  test('a short desktop window keeps the table of contents in reach', async ({ page }) => {
    await page.setViewportSize({ width: 1366, height: 650 });
    for (const path of ['/terms', '/faq']) {
      await page.goto(path);
      const aside = page.locator('aside').filter({ has: page.locator('[data-toc]') });
      await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight * 0.6));

      // Still beside the text, and the entry being read is on screen.
      await expect
        .poll(async () => (await aside.boundingBox())?.y ?? -1, {
          message: `${path}: list on screen`,
        })
        .toBeGreaterThanOrEqual(0);
      await expect(aside.locator('[data-toc] a[aria-current="true"]')).toBeInViewport();

      // The last entry can be reached inside the list and followed.
      const last = aside.locator('[data-toc] a').last();
      const href = await last.getAttribute('href');
      await last.scrollIntoViewIfNeeded();
      await last.click();
      await expect(page).toHaveURL(new RegExp(`${href}$`));
      await expect(page.locator(href ?? '#missing')).toBeInViewport();
    }
  });

  test('FAQ topics jump to their questions', async ({ page }) => {
    await page.goto('/faq');
    const topics = page.getByRole('complementary').getByRole('navigation', { name: 'FAQ topics' });
    await topics.getByRole('link', { name: /Paying by bKash/ }).click();
    await expect(page).toHaveURL(/#paying-by-bkash$/);
    await expect(page.locator('section#paying-by-bkash details')).toHaveCount(2);
  });

  test('About shows the cover band and the three steps; Contact the channels', async ({ page }) => {
    await page.goto('/about');
    await expect(page.getByTestId('about-cover')).toBeVisible();
    await expect(page.getByRole('main').getByRole('heading', { level: 3 })).toHaveText([
      'Register',
      'Pay by bKash',
      'Get scanned at the door',
    ]);
    await page.goto('/contact');
    await expect(page.getByRole('heading', { name: 'Ways to reach us' })).toBeVisible();
    await expect(page.getByText('EA-7K2Q9M')).toBeVisible();
  });
});
