import { logger } from '@/server/lib/logger';
import type {
  SettingsPatch,
  SettingsRecord,
  SettingsRepository,
} from '@/server/repositories/settings.repository';
import { ORGANIZER_NAME, VERIFICATION_SLA } from '@/content/site';
import {
  bkashReceiveNumber,
  facebookPageUrl,
  organizerContactEmail,
  organizerPhone,
} from '@/lib/env.public';

/**
 * Site settings (B14): what the organizer can change without a deploy.
 *
 * Env is only a SEED for a database that has never been saved: until then
 * the env variables (bKash number, contact details, Facebook page) are the
 * effective values, so a fresh install and CI behave exactly as before. The
 * form pre-fills those values, so the first save copies them into the row —
 * and from then on the row is the truth: a NULL column is a deliberate
 * "none" (hide the link, no phone), never "go back to env". Otherwise
 * clearing a field would be silently undone on the next render (found in
 * review). The two strings that are always quoted in copy (promise, name)
 * are required by the form and fall back to the site.ts constants only for
 * a row that predates that rule.
 */
export type BkashAccountType = SettingsRecord['bkashAccountType'];

export interface SiteSettings {
  /** "01712 345678" — displayed as stored; null when nowhere to send money yet. */
  bkashReceiveNumber: string | null;
  bkashAccountName: string | null;
  /** Drives buyer wording: "Send Money" (personal) vs "Payment" (merchant). */
  bkashAccountType: BkashAccountType;
  supportEmail: string | null;
  supportPhone: string | null;
  facebookPageUrl: string | null;
  /** "usually within 4 hours" — always set (constant fallback). */
  verificationPromise: string;
  /** Always set (constant fallback). */
  organizerName: string;
  organizerAddress: string | null;
  updatedAt: Date | null;
  updatedBy: string | null;
}

/** Pure: the saved row, or the env seed when nothing has ever been saved. */
export function resolveSettings(
  row: SettingsRecord | null,
  env: NodeJS.ProcessEnv = process.env,
): SiteSettings {
  const seed = <T>(value: T | null): T | null => (row === null ? value : null);
  return {
    bkashReceiveNumber: row?.bkashReceiveNumber ?? seed(bkashReceiveNumber(env)),
    bkashAccountName: row?.bkashAccountName ?? null,
    bkashAccountType: row?.bkashAccountType ?? 'personal',
    supportEmail: row?.supportEmail ?? seed(organizerContactEmail(env)),
    supportPhone: row?.supportPhone ?? seed(organizerPhone(env)),
    facebookPageUrl: row?.facebookPageUrl ?? seed(facebookPageUrl(env)),
    verificationPromise: row?.verificationPromise ?? VERIFICATION_SLA,
    organizerName: row?.organizerName ?? ORGANIZER_NAME,
    organizerAddress: row?.organizerAddress ?? null,
    updatedAt: row?.updatedAt ?? null,
    updatedBy: row?.updatedBy ?? null,
  };
}

export function createSettingsService(
  repo: SettingsRepository,
  { env = process.env }: { env?: NodeJS.ProcessEnv } = {},
) {
  return {
    async get(): Promise<SiteSettings> {
      return resolveSettings(await repo.get(), env);
    },

    /**
     * Save every field (the form always submits all of them; a blank is
     * null = "none", see resolveSettings). Who saved it is on the row and in the log — values
     * are not logged: they are public anyway, but the log is not the place
     * to audit the organizer's phone number changes.
     */
    async update(input: SettingsPatch, actor: string): Promise<SiteSettings> {
      const before = await repo.get();
      const row = await repo.upsert(input, actor);
      const changed = (Object.keys(input) as (keyof SettingsPatch)[]).filter(
        (k) => (before?.[k] ?? null) !== (row[k] ?? null),
      );
      logger.info({ actor, changed }, 'settings saved');
      return resolveSettings(row, env);
    },
  };
}

export type SettingsService = ReturnType<typeof createSettingsService>;
