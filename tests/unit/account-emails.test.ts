import { describe, expect, it, vi } from 'vitest';
import {
  type AccountEmail,
  sendNewEmailConfirmation,
  sendPasswordReset,
  takeExposedAccountLink,
} from '@/server/auth/account-emails';

const URL_ =
  'https://echoandaura.com/api/auth/reset-password/tok?callbackURL=%2Fadmin%2Freset-password';
// `next start` forces NODE_ENV=production even for e2e; APP_ENV is the gate.
const TEST_ENV: NodeJS.ProcessEnv = {
  NODE_ENV: 'production',
  APP_ENV: 'test',
  E2E_EXPOSE_MAGIC_LINK: '1',
};
const PROD_ENV: NodeJS.ProcessEnv = {
  NODE_ENV: 'production',
  APP_ENV: 'production',
  E2E_EXPOSE_MAGIC_LINK: '1',
};

function deps(role: string | null, env: NodeJS.ProcessEnv = PROD_ENV) {
  const sent: AccountEmail[] = [];
  return {
    sent,
    roleOf: vi.fn(async () => role),
    enqueue: vi.fn(async (e: AccountEmail) => {
      sent.push(e);
    }),
    env,
  };
}

describe('sendPasswordReset (ADR-038)', () => {
  it('queues the reset for an admin', async () => {
    const d = deps('admin');
    await sendPasswordReset({ email: 'raj@example.com', url: URL_ }, d);
    expect(d.sent).toEqual([{ kind: 'password-reset', to: 'raj@example.com', url: URL_ }]);
  });

  it.each([['buyer'], [null]])(
    'sends nothing for a %s address (no password, no second way in)',
    async (role) => {
      const d = deps(role);
      await sendPasswordReset({ email: 'someone@example.com', url: URL_ }, d);
      expect(d.enqueue).not.toHaveBeenCalled();
    },
  );

  it('a queue failure reaches the caller (the page must not say "sent")', async () => {
    const d = deps('admin');
    d.enqueue.mockRejectedValueOnce(new Error('redis down'));
    await expect(sendPasswordReset({ email: 'raj@example.com', url: URL_ }, d)).rejects.toThrow(
      'redis down',
    );
  });
});

describe('sendNewEmailConfirmation (ADR-038)', () => {
  it('queues the confirmation to the NEW address for an admin', async () => {
    const d = deps(null);
    await sendNewEmailConfirmation({ newEmail: 'new@example.com', role: 'admin', url: URL_ }, d);
    expect(d.sent).toEqual([{ kind: 'confirm-new-email', to: 'new@example.com', url: URL_ }]);
  });

  it.each([['buyer'], [undefined], [42]])('refuses a %j session', async (role) => {
    const d = deps(null);
    await sendNewEmailConfirmation({ newEmail: 'new@example.com', role, url: URL_ }, d);
    expect(d.enqueue).not.toHaveBeenCalled();
  });
});

describe('the e2e link seam', () => {
  it('keeps the last link only under APP_ENV=test with the flag, once', async () => {
    await sendPasswordReset({ email: 'Raj@Example.com', url: URL_ }, deps('admin', TEST_ENV));
    expect(takeExposedAccountLink('password-reset', 'raj@example.com', TEST_ENV)).toBe(URL_);
    expect(takeExposedAccountLink('password-reset', 'raj@example.com', TEST_ENV)).toBeNull();
  });

  it('never keeps or shows a link in production, even with the flag set', async () => {
    await sendPasswordReset({ email: 'raj@example.com', url: URL_ }, deps('admin', PROD_ENV));
    expect(takeExposedAccountLink('password-reset', 'raj@example.com', TEST_ENV)).toBeNull();
    expect(takeExposedAccountLink('password-reset', 'raj@example.com', PROD_ENV)).toBeNull();
  });

  it('does not expose a link that was never sent (a buyer address)', async () => {
    await sendPasswordReset({ email: 'buyer@example.com', url: URL_ }, deps('buyer', TEST_ENV));
    expect(takeExposedAccountLink('password-reset', 'buyer@example.com', TEST_ENV)).toBeNull();
  });
});
