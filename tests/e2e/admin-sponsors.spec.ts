import path from 'node:path';
import { expect, test, type Page } from '@playwright/test';

// Requires a seeded admin (pnpm admin:create) and MinIO (docker compose):
// logos are stored for real and drawn from storage.
const email = process.env.E2E_ADMIN_EMAIL ?? 'admin@example.com';
const password = process.env.E2E_ADMIN_PASSWORD ?? 'correct-horse-battery';
const FIXTURES = path.join(__dirname, 'fixtures');
const LOGO_SVG = path.join(FIXTURES, 'logo.svg');
const LOGO_PNG = path.join(FIXTURES, 'logo.png');
const UNSAFE_SVG = path.join(FIXTURES, 'unsafe.svg');
const COVER = path.join(FIXTURES, 'cover.png');

// The tests build on each other (add → reorder → on the site → hide → demote → delete),
// so they run in order, and every name carries this run's suffix: the list
// is shared with anything else that ever adds a sponsor.
test.describe.configure({ mode: 'serial' });
const RUN = Date.now().toString(36);
const A = `Nodi Coffee ${RUN}`;
const B = `Parabaas Printing ${RUN}`;
const C = `Megh Stage ${RUN}`;
const P1 = `Kolorob Audio ${RUN}`;
const P2 = `Bhor FM ${RUN}`;
const D = `Shonar Tori ${RUN}`;

type Level = 'presenting' | 'partner' | 'supporter';
const LEVEL_LABEL = {
  presenting: 'Presenting partner',
  partner: 'Partner',
  supporter: 'Supporter',
};

async function signIn(page: Page) {
  await page.goto('/admin/login');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill(password);
  await page.getByRole('button', { name: /^sign in$/i }).click();
  await expect(page).toHaveURL(/\/admin$/, { timeout: 20_000 });
}

/** The list, once its client islands are hydrated. */
async function openList(page: Page) {
  await page.goto('/admin/sponsors');
  await page.waitForLoadState('networkidle');
}

/** A segmented control: the radios are visually hidden, so click the label. */
async function choose(page: Page, group: string, option: string) {
  const fieldset = page.getByRole('group', { name: group });
  await fieldset.getByText(option, { exact: true }).click();
  await expect(fieldset.getByRole('radio', { name: option, exact: true })).toBeChecked();
}

async function addSponsor(
  page: Page,
  s: { name: string; level: Level; logo: string; website?: string; dark?: boolean },
) {
  await page.goto('/admin/sponsors/new');
  await page.waitForLoadState('networkidle');
  await page.getByLabel('Name', { exact: true }).fill(s.name);
  if (s.website) await page.getByLabel('Website').fill(s.website);
  await choose(page, 'Level', LEVEL_LABEL[s.level]);
  await page.getByTestId('logo-file').setInputFiles(s.logo);
  // The file passed the in-browser check and is held for the submit.
  await expect(page.getByText('Replace logo')).toBeVisible();
  if (s.dark) await choose(page, 'Tile behind the logo', 'Dark');
  await page.getByRole('button', { name: 'Add sponsor', exact: true }).click();
  await expect(page).toHaveURL(/\/admin\/sponsors\?saved=/, { timeout: 20_000 });
  await expect(page.getByRole('status')).toContainText(`${s.name} saved.`);
}

/** B5 editor tabs are URL state; click the tab before touching its section. */
async function openTab(page: Page, name: 'Details' | 'Cover image' | 'Ticket types' | 'Publish') {
  await page
    .getByRole('navigation', { name: /event sections/i })
    .getByRole('link', { name })
    .click();
}

/** The page's own title — the shell's header has an h1 (the section) too. */
const title = (page: Page) => page.getByRole('main').getByRole('heading', { level: 1 });

const row = (page: Page, name: string) => page.getByTestId('sponsor-row').filter({ hasText: name });

/** A public sponsor link's name: the tile shows only a logo, so the label is the name. */
const newTab = (name: string) => `${name} (opens in a new tab)`;

/** This run's sponsors in a level, in display order. */
async function order(page: Page, level: Level): Promise<string[]> {
  const names = await page
    .getByTestId(`sponsor-group-${level}`)
    .getByTestId('sponsor-name')
    .allTextContents();
  return names.filter((n) => n.endsWith(RUN));
}

test.describe('sponsors (B15)', () => {
  test('a signed-out visitor is sent to the login page', async ({ page }) => {
    const res = await page.request.get('/admin/sponsors', { maxRedirects: 0 });
    expect([302, 303, 307, 308]).toContain(res.status());
  });

  test('add sponsors with an SVG and a PNG logo; an unsafe SVG is refused', async ({ page }) => {
    test.slow();
    await signIn(page);
    await page
      .getByRole('navigation', { name: 'Admin' })
      .getByRole('link', { name: 'Sponsors' })
      .click();
    await expect(page).toHaveURL(/\/admin\/sponsors$/, { timeout: 20_000 });

    // A logo with a script is refused in the browser, before anything is sent.
    await page.goto('/admin/sponsors/new');
    await page.waitForLoadState('networkidle');
    await expect(title(page)).toContainText('Add sponsor');
    await page.getByLabel('Name', { exact: true }).fill(`Unsafe ${RUN}`);
    await page.getByTestId('logo-file').setInputFiles(UNSAFE_SVG);
    await expect(page.getByRole('main').getByRole('alert')).toHaveText(
      'The SVG contains a <script> element, which is not allowed in a logo.',
    );
    await expect(page.getByText('Upload logo')).toBeVisible();
    await page.getByRole('button', { name: 'Add sponsor', exact: true }).click();
    await expect(page.getByRole('main').getByRole('alert')).toContainText('<script>');
    await expect(page).toHaveURL(/\/admin\/sponsors\/new$/);

    await addSponsor(page, {
      name: A,
      level: 'partner',
      logo: LOGO_SVG,
      website: 'https://nodi.example',
    });
    await addSponsor(page, { name: B, level: 'partner', logo: LOGO_PNG, dark: true });
    await addSponsor(page, { name: C, level: 'partner', logo: LOGO_SVG });

    await expect.poll(() => order(page, 'partner')).toEqual([A, B, C]);
    await expect(row(page, A)).toContainText('https://nodi.example');
    await expect(row(page, C)).toContainText('No website');
    // A dark tile shows the logo on both tiles; a light one only on light.
    await expect(row(page, A).locator('img')).toHaveCount(1);
    await expect(row(page, B).locator('img')).toHaveCount(2);
    for (const img of await row(page, B).locator('img').all()) {
      await expect(img).toHaveJSProperty('complete', true);
      expect(await img.evaluate((el: HTMLImageElement) => el.naturalWidth)).toBeGreaterThan(0);
    }
  });

  test('reorder with ▼ and the order field; focus stays on the control', async ({ page }) => {
    await signIn(page);
    await openList(page);

    await page.getByRole('button', { name: `Move ${A} down` }).click();
    await expect(page.getByRole('status')).toHaveText('Order saved.');
    await expect.poll(() => order(page, 'partner')).toEqual([B, A, C]);
    await expect(page.getByRole('button', { name: `Move ${A} down` })).toBeFocused();
    // Other runs may have left partners above ours, so the check is on the
    // group's first row, not on B's absolute place.
    await expect(
      page
        .getByTestId('sponsor-group-partner')
        .getByTestId('sponsor-row')
        .first()
        .getByRole('button', { name: /^Move .* up$/ }),
    ).toBeDisabled();

    // The field saves on Enter, not per keystroke.
    const field = page.getByLabel(`Display order for ${C}`);
    await field.fill('1');
    await field.press('Enter');
    await expect.poll(() => order(page, 'partner')).toEqual([C, B, A]);
    await expect(page.getByLabel(`Display order for ${C}`)).toBeFocused();

    await page.reload();
    await expect.poll(() => order(page, 'partner')).toEqual([C, B, A]);
  });

  test('an active sponsor shows in "Supported by" on the home page and in the footer', async ({
    page,
  }) => {
    await page.goto('/');
    const section = page.getByRole('main').getByRole('region', { name: 'Supported by' });
    const tile = section.getByRole('link', { name: newTab(A), exact: true });
    await expect(tile).toHaveAttribute('href', 'https://nodi.example');
    await expect(tile).toHaveAttribute('target', '_blank');
    await expect(tile).toHaveAttribute('rel', 'sponsored noopener');
    // The logo is lazy: bring it into view, then it loads from storage.
    await tile.scrollIntoViewIfNeeded();
    await expect
      .poll(() => tile.locator('img').evaluate((el: HTMLImageElement) => el.naturalWidth))
      .toBeGreaterThan(0);
    // No website: a plain tile whose logo carries the name, not a link.
    await expect(section.getByRole('img', { name: B, exact: true })).toBeVisible();
    await expect(section.getByRole('link', { name: B })).toHaveCount(0);

    const footer = page.getByRole('contentinfo');
    await expect(footer.getByRole('link', { name: newTab(A), exact: true })).toHaveAttribute(
      'href',
      'https://nodi.example',
    );
    await expect(footer.getByRole('img', { name: B, exact: true })).toBeVisible();
  });

  test('the Active switch hides a sponsor without deleting it', async ({ page }) => {
    await signIn(page);
    await openList(page);

    const toggle = page.getByRole('switch', { name: `Show ${A} on the site` });
    await expect(toggle).toBeChecked();
    // A click before hydration does nothing; retry until the optimistic flip.
    await expect(async () => {
      await toggle.click();
      await expect(toggle).toHaveAttribute('aria-checked', 'false', { timeout: 1_000 });
    }).toPass({ timeout: 15_000 });
    await expect(page.getByRole('status')).toHaveText(`${A} is now hidden.`);
    await expect(toggle).not.toHaveAttribute('data-disabled');
    await page.waitForLoadState('networkidle');

    await page.reload();
    await expect(page.getByRole('switch', { name: `Show ${A} on the site` })).not.toBeChecked();
    await expect(row(page, A)).toContainText('Hidden');

    // Hidden is gone from the public pages too; the others stay.
    await page.goto('/');
    const main = page.getByRole('main');
    const footer = page.getByRole('contentinfo');
    await expect(footer.getByRole('img', { name: B, exact: true })).toBeVisible();
    await expect(main.getByRole('link', { name: newTab(A) })).toHaveCount(0);
    await expect(footer.getByRole('link', { name: newTab(A) })).toHaveCount(0);
  });

  test('a second presenting partner moves the first to Partner #1', async ({ page }) => {
    test.slow();
    await signIn(page);
    await addSponsor(page, { name: P1, level: 'presenting', logo: LOGO_SVG });
    await expect.poll(() => order(page, 'presenting')).toEqual([P1]);

    await page.goto('/admin/sponsors/new');
    await page.waitForLoadState('networkidle');
    await page.getByLabel('Name', { exact: true }).fill(P2);
    await choose(page, 'Level', 'Presenting partner');
    await expect(page.getByTestId('presenting-warning')).toHaveText(
      `${P1} is the presenting partner now. Saving makes it a Partner.`,
    );
    await page.getByTestId('logo-file').setInputFiles(LOGO_PNG);
    await expect(page.getByText('Replace logo')).toBeVisible();
    await page.getByRole('button', { name: 'Add sponsor', exact: true }).click();
    await expect(page.getByRole('status')).toContainText(`${P2} saved.`);

    await expect.poll(() => order(page, 'presenting')).toEqual([P2]);
    await expect.poll(() => order(page, 'partner')).toEqual([P1, C, B, A]);
  });

  test('edit a sponsor, then delete from the list and from the form', async ({ page }) => {
    test.slow();
    await signIn(page);
    await openList(page);

    // Edit: the page is titled with the name and previews the stored logo.
    await row(page, A)
      .getByRole('link', { name: `Edit ${A}` })
      .click();
    await expect(title(page)).toContainText(A);
    await page.waitForLoadState('networkidle');
    await expect(page.getByTestId('sponsor-preview').locator('img').first()).toBeVisible();
    await expect(page.getByText('Replace logo')).toBeVisible();
    await expect(page.getByLabel('Website')).toHaveValue('https://nodi.example');
    await choose(page, 'Tile behind the logo', 'Dark');
    await page.getByRole('button', { name: 'Save changes' }).click();
    await expect(page.getByRole('status')).toContainText(`${A} saved.`);
    await expect(row(page, A).locator('img')).toHaveCount(2);
    await page.waitForLoadState('networkidle');

    // From the list: the dialog first, then the row goes.
    const trigger = page.getByRole('button', { name: `Delete ${C}` });
    const dialog = page.getByRole('alertdialog');
    await expect(async () => {
      await trigger.click();
      await expect(dialog).toBeVisible({ timeout: 1_000 });
    }).toPass({ timeout: 15_000 });
    await expect(dialog.getByRole('heading')).toHaveText(`Delete ${C}?`);
    await expect(dialog).toContainText('To hide a sponsor for now, turn off Active instead.');
    await dialog.getByRole('button', { name: 'Delete sponsor' }).click();
    await expect(page.getByRole('status')).toHaveText(`${C} deleted.`);
    await expect(row(page, C)).toHaveCount(0);

    // From the edit form: back to the list, which says so.
    await row(page, B)
      .getByRole('link', { name: `Edit ${B}` })
      .click();
    await expect(title(page)).toContainText(B);
    await page.waitForLoadState('networkidle');
    await page.getByRole('button', { name: 'Delete sponsor' }).click();
    await page.getByRole('alertdialog').getByRole('button', { name: 'Delete sponsor' }).click();
    await expect(page).toHaveURL(/\/admin\/sponsors\?deleted=/);
    await expect(page.getByRole('status')).toHaveText(`${B} deleted.`);
    await expect(row(page, B)).toHaveCount(0);
    await expect.poll(() => order(page, 'partner')).toEqual([P1, A]);

    // A sponsor that does not exist is a 404, not an empty form.
    const res = await page.goto('/admin/sponsors/0b1c2d3e-4f5a-4b6c-8d7e-9f0a1b2c3d4e/edit');
    expect(res?.status()).toBe(404);
  });
  test('an event names a presenter in its form; the page shows it until it is hidden', async ({
    page,
  }) => {
    test.slow();
    await signIn(page);
    await addSponsor(page, {
      name: D,
      level: 'supporter',
      logo: LOGO_SVG,
      website: 'https://shonartori.example',
    });

    // Far ahead, with the default window: never the home page's hero.
    await page.goto('/admin/events/new');
    await page.getByLabel('Title', { exact: true }).fill(`Presented ${RUN}`);
    await page.getByLabel(/^Starts at/).fill('2030-12-05T19:00');
    await page.getByLabel('Presenting sponsor').selectOption({ label: D });
    await page.getByRole('button', { name: /create event/i }).click();
    await expect(page).toHaveURL(/\/admin\/events\/[0-9a-f-]{36}\/edit$/);
    const slug = await page.getByLabel(/^URL slug/).inputValue();
    const editUrl = page.url();
    await expect(page.getByLabel('Presenting sponsor').locator('option:checked')).toHaveText(D);

    await openTab(page, 'Ticket types');
    await page
      .getByRole('link', { name: /add ticket type/i })
      .first()
      .click();
    await page.getByLabel('Name', { exact: true }).fill('General');
    await page.getByLabel(/^Price/).fill('600');
    await page.getByLabel('Quantity', { exact: true }).fill('50');
    await page.getByRole('button', { name: /add ticket type/i }).click();
    await expect(page).toHaveURL(/tab=ticket-types$/);
    await openTab(page, 'Cover image');
    await page.getByTestId('cover-file').setInputFiles(COVER);
    await expect(page.getByTestId('cover-image')).toBeVisible();
    await openTab(page, 'Publish');
    await page.getByRole('button', { name: /^publish$/i }).click();
    await expect(page.getByTestId('event-status')).toHaveText('published');

    try {
      await page.goto(`/events/${slug}`);
      const presented = page.getByTestId('presented-by');
      await expect(presented).toContainText('Presented by');
      await expect(presented).toContainText(D);
      // Named by its text — why the sponsor is here — plus the new-tab note.
      const link = page.getByRole('link', {
        name: `Presented by ${D} (opens in a new tab)`,
        exact: true,
      });
      await expect(link).toHaveAttribute('href', 'https://shonartori.example');
      await expect(link).toHaveAttribute('target', '_blank');
      await expect(link).toHaveAttribute('rel', 'sponsored noopener');
      await expect
        .poll(() => link.locator('img').evaluate((el: HTMLImageElement) => el.naturalWidth))
        .toBeGreaterThan(0);

      // Hidden: the event keeps its presenter, the page stops showing it.
      await openList(page);
      const toggle = page.getByRole('switch', { name: `Show ${D} on the site` });
      await expect(async () => {
        await toggle.click();
        await expect(toggle).toHaveAttribute('aria-checked', 'false', { timeout: 1_000 });
      }).toPass({ timeout: 15_000 });
      await expect(page.getByRole('status')).toHaveText(`${D} is now hidden.`);
      await page.waitForLoadState('networkidle');

      await page.goto(`/events/${slug}`);
      await expect(page.getByRole('heading', { level: 1 })).toHaveText(`Presented ${RUN}`);
      await expect(page.getByTestId('presented-by')).toHaveCount(0);
      await expect(page.getByText(D)).toHaveCount(0);

      await page.goto(editUrl);
      await expect(page.getByLabel('Presenting sponsor').locator('option:checked')).toHaveText(
        `${D} (hidden)`,
      );
    } finally {
      // Unpublished, so /events and the home page never pick it up again.
      await page.goto(`${editUrl}?tab=publish`);
      await page.getByRole('button', { name: /^unpublish$/i }).click();
      await expect(page.getByTestId('event-status')).toHaveText('draft');
    }
  });
});
