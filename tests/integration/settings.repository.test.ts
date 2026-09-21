import { migrate } from 'drizzle-orm/postgres-js/migrator';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { db, queryClient } from '@/db/client';
import * as schema from '@/db/schema';
import { isCheckViolation } from '@/server/lib/pg-errors';
import { settingsRepository } from '@/server/repositories/settings.repository';

/**
 * B14 against real Postgres: the upsert creates the single row, updates it
 * in place afterwards, and the CHECK keeps it single.
 */
describe('settingsRepository (Postgres)', () => {
  const values = {
    bkashReceiveNumber: '01712 345678',
    bkashAccountName: 'Rajibul Karim',
    bkashAccountType: 'personal' as const,
    supportEmail: 'hello@example.com',
    supportPhone: null,
    facebookPageUrl: null,
    verificationPromise: 'usually within 4 hours',
    organizerName: 'Raj',
    organizerAddress: null,
  };

  beforeAll(async () => {
    await migrate(db, { migrationsFolder: './drizzle' });
    await db.delete(schema.settings);
  });

  afterAll(async () => {
    await db.delete(schema.settings);
    await queryClient.end();
  });

  it('is empty until the first save, then one row that later saves update in place', async () => {
    expect(await settingsRepository.get()).toBeNull();

    const first = await settingsRepository.upsert(values, 'raj@example.com');
    expect(first).toMatchObject({ id: 1, ...values, updatedBy: 'raj@example.com' });

    const second = await settingsRepository.upsert(
      { ...values, bkashReceiveNumber: '01999 111222', bkashAccountType: 'merchant' },
      'other@example.com',
    );
    expect(second).toMatchObject({
      id: 1,
      bkashReceiveNumber: '01999 111222',
      bkashAccountType: 'merchant',
      updatedBy: 'other@example.com',
    });
    expect(second.updatedAt.getTime()).toBeGreaterThanOrEqual(first.updatedAt.getTime());

    // An explicit null clears a column that was set — "none", not "keep".
    const cleared = await settingsRepository.upsert(
      { ...values, bkashAccountName: null, supportEmail: null },
      'raj@example.com',
    );
    expect(cleared.bkashAccountName).toBeNull();
    expect(cleared.supportEmail).toBeNull();
    expect(cleared.bkashReceiveNumber).toBe('01712 345678');

    const rows = await db.select().from(schema.settings);
    expect(rows).toHaveLength(1);
    expect((await settingsRepository.get())?.bkashAccountName).toBeNull();
  });

  it('the CHECK refuses a second row', async () => {
    const err = await db
      .insert(schema.settings)
      .values({ id: 2 })
      .then(
        () => null,
        (e: unknown) => e,
      );
    expect(isCheckViolation(err, 'settings_single_row')).toBe(true);
  });
});
