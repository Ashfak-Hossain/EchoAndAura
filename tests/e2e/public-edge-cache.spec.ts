import { expect, test } from './test';
import { signInAsAdmin } from './fixtures/admin';
import { publishedEvent } from './door-helpers';

/**
 * ADR-056: Cloudflare serves these pages from its edge for 30 s to anyone
 * without a `better-auth` cookie (docs/infra/CLOUDFLARE.md § Cache rules).
 * One cached response goes to every anonymous visitor, so it must set no
 * cookie — a cookie in it would be handed to strangers. Keep this list
 * equal to the rule's.
 */
const CACHED = [
  '/',
  '/events',
  '/archive',
  '/about',
  '/faq',
  '/terms',
  '/privacy',
  '/refund',
  '/contact',
];

test.describe('pages cached at the edge (ADR-056)', () => {
  test('an anonymous visit sets no cookie and tells browsers to keep nothing', async ({
    page,
    request,
  }) => {
    await signInAsAdmin(page);
    const { slug } = await publishedEvent(page, `Edge cache ${Date.now()}`);

    // `request` has its own cookie jar: the admin session above is not in it.
    for (const path of [...CACHED, `/events/${slug}`]) {
      const res = await request.get(path);
      expect(res.status(), path).toBe(200);
      expect(res.headers()['set-cookie'], path).toBeUndefined();
      // Only Cloudflare keeps a copy (its rule ignores this); browsers do not.
      expect(res.headers()['cache-control'], path).toContain('no-store');
    }
  });
});
