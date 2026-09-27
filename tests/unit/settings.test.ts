import { describe, expect, it, vi } from 'vitest';
import type { SettingsRecord, SettingsRepository } from '@/server/repositories/settings.repository';
import { createSettingsService, resolveSettings } from '@/server/services/settings.service';
import { formatBdMobile, settingsFormSchema } from '@/lib/validation/settings';

const env = (v: Record<string, string>) => v as unknown as NodeJS.ProcessEnv;

function row(over: Partial<SettingsRecord> = {}): SettingsRecord {
  return {
    id: 1,
    bkashReceiveNumber: null,
    bkashAccountName: null,
    bkashAccountType: 'personal',
    supportEmail: null,
    supportPhone: null,
    facebookPageUrl: null,
    verificationPromise: null,
    organizerName: null,
    organizerAddress: null,
    updatedBy: null,
    updatedAt: new Date('2026-09-21T10:00:00Z'),
    ...over,
  };
}

describe('resolveSettings', () => {
  it('seeds from the environment and the site constants when nothing has ever been saved', () => {
    const s = resolveSettings(
      null,
      env({
        BKASH_RECEIVE_NUMBER: '01712 345678',
        ORGANIZER_CONTACT_EMAIL: 'hello@example.com',
        ORGANIZER_PHONE: '01712 000000',
        FACEBOOK_PAGE_URL: 'https://facebook.com/x',
      }),
    );
    expect(s).toMatchObject({
      bkashReceiveNumber: '01712 345678',
      bkashAccountName: null,
      bkashAccountType: 'personal',
      supportEmail: 'hello@example.com',
      supportPhone: '01712 000000',
      facebookPageUrl: 'https://facebook.com/x',
      verificationPromise: 'usually within 4 hours, always within a day',
      organizerName: 'Raj',
      organizerAddress: null,
      updatedAt: null,
      updatedBy: null,
    });
    // No env at all: still a complete object — the constants carry the promise and name.
    expect(resolveSettings(null, env({}))).toMatchObject({
      bkashReceiveNumber: null,
      supportEmail: null,
      verificationPromise: 'usually within 4 hours, always within a day',
      organizerName: 'Raj',
    });
  });

  // Once a row exists it is the truth: a NULL column is "none", never "back
  // to env" — otherwise clearing the Facebook link would be undone on reload.
  it('once saved, the row is the truth: NULL means none even when env has a value', () => {
    const s = resolveSettings(
      row({
        bkashReceiveNumber: '01999 111222',
        bkashAccountType: 'merchant',
        verificationPromise: 'within the hour',
        updatedBy: 'raj@example.com',
      }),
      env({
        BKASH_RECEIVE_NUMBER: '01712 345678',
        ORGANIZER_CONTACT_EMAIL: 'hello@example.com',
        FACEBOOK_PAGE_URL: 'https://facebook.com/x',
      }),
    );
    expect(s.bkashReceiveNumber).toBe('01999 111222');
    expect(s.bkashAccountType).toBe('merchant');
    expect(s.verificationPromise).toBe('within the hour');
    expect(s.supportEmail).toBeNull(); // cleared — env does not creep back
    expect(s.facebookPageUrl).toBeNull();
    expect(s.organizerName).toBe('Raj'); // required on the form; constant only for a legacy row
    expect(s.updatedBy).toBe('raj@example.com');
    expect(s.updatedAt?.toISOString()).toBe('2026-09-21T10:00:00.000Z');
  });
});

describe('formatBdMobile', () => {
  it('turns E.164 into the form people copy into bKash, and refuses anything else', () => {
    expect(formatBdMobile('+8801712345678')).toBe('01712 345678');
    expect(formatBdMobile('+8801312345678')).toBe('01312 345678');
    expect(() => formatBdMobile('01712345678')).toThrow(/E\.164/);
  });
});

describe('settingsFormSchema', () => {
  const valid = {
    bkashReceiveNumber: '01712-345678',
    bkashAccountName: ' Rajibul Karim ',
    bkashAccountType: 'merchant',
    supportEmail: ' Hello@Example.com ',
    supportPhone: '+880 1912 345678',
    facebookPageUrl: 'https://facebook.com/echoandaura',
    verificationPromise: 'usually within 4 hours',
    organizerName: 'Raj',
    organizerAddress: '',
  };

  it('normalises numbers to "01712 345678", trims text, and turns blanks into null', () => {
    const out = settingsFormSchema.parse(valid);
    expect(out).toEqual({
      bkashReceiveNumber: '01712 345678',
      bkashAccountName: 'Rajibul Karim',
      bkashAccountType: 'merchant',
      supportEmail: 'Hello@Example.com',
      supportPhone: '01912 345678',
      facebookPageUrl: 'https://facebook.com/echoandaura',
      verificationPromise: 'usually within 4 hours',
      organizerName: 'Raj',
      organizerAddress: null,
    });
    // Every optional field blank is a valid "none" submission; the two
    // always-quoted strings are required.
    const blank = settingsFormSchema.parse({
      ...Object.fromEntries(Object.keys(valid).map((k) => [k, ''])),
      bkashAccountType: 'personal',
      verificationPromise: 'within a day',
      organizerName: 'Raj',
    });
    expect(blank.bkashReceiveNumber).toBeNull();
    expect(blank.facebookPageUrl).toBeNull();
    expect(blank.organizerAddress).toBeNull();
  });

  // Failure paths: each names the field so the form can mark it.
  it('refuses a bad number, an http Facebook link, a two-letter promise, a wrong account type', () => {
    const fails = (patch: Record<string, string>, field: string, message: RegExp) => {
      const r = settingsFormSchema.safeParse({ ...valid, ...patch });
      expect(r.success).toBe(false);
      if (!r.success) {
        expect(r.error.issues[0]?.path[0]).toBe(field);
        expect(r.error.issues[0]?.message).toMatch(message);
      }
    };
    fails({ bkashReceiveNumber: '12345' }, 'bkashReceiveNumber', /10 digits/);
    fails({ supportPhone: '01712 34567' }, 'supportPhone', /10 digits/);
    fails({ supportEmail: 'not-an-email' }, 'supportEmail', /valid email/);
    fails({ facebookPageUrl: 'http://facebook.com/x' }, 'facebookPageUrl', /https/);
    fails({ facebookPageUrl: 'facebook.com/x' }, 'facebookPageUrl', /https/);
    fails({ verificationPromise: 'ok' }, 'verificationPromise', /how quickly/);
    fails({ verificationPromise: 'x'.repeat(81) }, 'verificationPromise', /under 80/);
    fails({ organizerName: 'R' }, 'organizerName', /organizer name/i);
    fails({ organizerName: '' }, 'organizerName', /organizer name/i);
    fails({ verificationPromise: '' }, 'verificationPromise', /how quickly/);
    fails({ organizerAddress: 'x'.repeat(201) }, 'organizerAddress', /too long/);
    fails({ bkashAccountType: 'business' }, 'bkashAccountType', /account type/);
  });
});

describe('settingsService', () => {
  function fakeRepo() {
    let stored: SettingsRecord | null = null;
    const repo: SettingsRepository = {
      get: vi.fn(async () => stored),
      upsert: vi.fn(async (values, updatedBy) => {
        const next: SettingsRecord = {
          ...row(),
          ...(stored ?? {}),
          ...values,
          updatedBy,
          updatedAt: new Date(),
        };
        stored = next;
        return next;
      }),
    };
    return {
      repo,
      get stored() {
        return stored;
      },
    };
  }

  it('returns fallbacks before any save, then the saved row with the actor', async () => {
    const { repo } = fakeRepo();
    const svc = createSettingsService(repo, { env: env({ BKASH_RECEIVE_NUMBER: '01712 345678' }) });
    expect((await svc.get()).bkashReceiveNumber).toBe('01712 345678');

    const after = await svc.update(
      settingsFormSchema.parse({
        bkashReceiveNumber: '01999 111222',
        bkashAccountName: '',
        bkashAccountType: 'merchant',
        supportEmail: 'hello@example.com',
        supportPhone: '',
        facebookPageUrl: '',
        verificationPromise: 'within the hour',
        organizerName: 'Rajibul',
        organizerAddress: '',
      }),
      'raj@example.com',
    );
    expect(after).toMatchObject({
      bkashReceiveNumber: '01999 111222',
      bkashAccountType: 'merchant',
      supportEmail: 'hello@example.com',
      supportPhone: null, // blank → none
      verificationPromise: 'within the hour',
      organizerName: 'Rajibul',
      updatedBy: 'raj@example.com',
    });
    expect(repo.upsert).toHaveBeenCalledWith(
      expect.objectContaining({ supportPhone: null, organizerAddress: null }),
      'raj@example.com',
    );
    expect((await svc.get()).bkashReceiveNumber).toBe('01999 111222');
  });
});
