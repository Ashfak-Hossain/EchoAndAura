import { test as base, type BrowserContext } from '@playwright/test';

export { expect, type Page } from '@playwright/test';

/** Chrome's wording for every CSP block: scripts, images, WebAssembly, frames. */
const CSP_MESSAGE = /Content Security Policy/;

/**
 * ADR-043: every spec imports `test` from here, so the whole suite doubles
 * as a CSP check. The suite runs the production build with the real policy
 * (src/proxy.ts); anything the policy blocks (a script, an image host, the
 * door's WebAssembly) fails the test that hit it, instead of silently
 * breaking a page in production.
 *
 * The door specs open their own contexts (one per phone) with
 * `browser.newContext()`, so the guard watches those too.
 */
export const test = base.extend<{ cspGuard: undefined }>({
  cspGuard: [
    async ({ context, browser }, run) => {
      const violations: string[] = [];
      const watch = (ctx: BrowserContext) => {
        ctx.on('console', (msg) => {
          if (msg.type() === 'error' && CSP_MESSAGE.test(msg.text())) {
            violations.push(`${msg.page()?.url() ?? '?'}: ${msg.text()}`);
          }
        });
        ctx.on('weberror', (err) => {
          if (CSP_MESSAGE.test(err.error().message)) {
            violations.push(`${err.page()?.url() ?? '?'}: ${err.error().message}`);
          }
        });
      };
      watch(context);

      // Tests in a worker run one at a time, so swapping the method for the
      // test's duration can't leak into another test.
      const newContext = browser.newContext.bind(browser);
      browser.newContext = async (...args) => {
        const ctx = await newContext(...args);
        watch(ctx);
        return ctx;
      };
      try {
        await run(undefined);
      } finally {
        browser.newContext = newContext;
      }

      base.expect(violations, 'Content-Security-Policy violations').toEqual([]);
    },
    { auto: true },
  ],
});
