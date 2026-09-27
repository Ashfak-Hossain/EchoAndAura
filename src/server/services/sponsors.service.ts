import { randomUUID } from 'node:crypto';
import type { DbExecutor } from '@/db/executor';
import { sponsorLevel } from '@/db/schema';
import { SponsorLogoInvalidError, SponsorNotFoundError } from '@/server/lib/errors';
import { logger as defaultLogger } from '@/server/lib/logger';
import {
  type SponsorLogoContentType,
  type SponsorLogoExt,
  inspectLogo,
} from '@/server/lib/sponsor-logo';
import { sponsorLogoKey } from '@/server/lib/sponsor-logo-key';
import type {
  SponsorLevel,
  SponsorRecord,
  SponsorsRepository,
  SponsorTileTone,
} from '@/server/repositories/sponsors.repository';
import type { ObjectStorage } from '@/server/storage/object-storage';

/**
 * B15 sponsors: the admin screen, and the list "Supported by" and the
 * footer read. Sponsors touch no money or order state; changes are logged
 * with the actor, like promo codes.
 *
 * Logos go through the server (plan decision 1): the bytes are inspected
 * (shape for the tile formula, the SVG screen), stored under a fresh key
 * with `Content-Disposition: attachment`, and only then is the row written.
 * Storage calls never run inside the transaction (Invariant 7): the upload
 * happens before it, and a replaced or deleted logo is removed after
 * commit, best-effort. If the database step fails, the upload it was for
 * is removed again.
 *
 * Order within a level is one primitive — a position, clamped to 1…n+1 and
 * renumbered densely — under an advisory lock every write takes.
 */

export interface SponsorLogoUpload {
  bytes: Uint8Array;
  /** As the browser sent it; `inspectLogo` normalises it. */
  contentType: string;
}

export interface SponsorInput {
  name: string;
  websiteUrl: string | null;
  level: SponsorLevel;
  tileTone: SponsorTileTone;
  active: boolean;
  /**
   * 1-based place within the level, clamped to 1…n+1. Omitted: the end of
   * the level for a new sponsor or one moving level; unchanged otherwise.
   */
  position?: number;
}

export interface CreateSponsorInput extends SponsorInput {
  logo: SponsorLogoUpload;
}

export interface UpdateSponsorInput extends SponsorInput {
  /** Omitted: keep the current logo. */
  logo?: SponsorLogoUpload;
}

export interface AdminSponsor extends SponsorRecord {
  logoUrl: string;
}

/** One level of the B15 list, in display order. Every level is present, even when empty. */
export interface AdminSponsorGroup {
  level: SponsorLevel;
  sponsors: AdminSponsor[];
}

/** What the public pages need to draw a tile — nothing about ordering or visibility. */
export interface PublicSponsor {
  id: string;
  name: string;
  websiteUrl: string | null;
  level: SponsorLevel;
  tileTone: SponsorTileTone;
  logoUrl: string;
  logoWidth: number;
  logoHeight: number;
}

export interface SponsorsLogger {
  info(obj: Record<string, unknown>, msg: string): void;
  warn(obj: Record<string, unknown>, msg: string): void;
}

export interface SponsorsServiceDeps {
  sponsors: SponsorsRepository;
  storage: Pick<ObjectStorage, 'put' | 'delete' | 'publicUrl'>;
  runInTransaction: <T>(fn: (tx: DbExecutor) => Promise<T>) => Promise<T>;
  now?: () => Date;
  /** The sponsor's id is made before the upload, so the logo key carries its owner. */
  newId?: () => string;
  logger?: SponsorsLogger;
}

/** presenting → partner → supporter: the enum's declaration order is display order. */
const LEVELS: readonly SponsorLevel[] = sponsorLevel.enumValues;

const CONTENT_TYPE: Record<SponsorLogoExt, SponsorLogoContentType> = {
  svg: 'image/svg+xml',
  png: 'image/png',
};

// A key names one file forever (a replaced logo gets a new key), so the
// object can be cached for a year without ever going stale.
const LOGO_CACHE_CONTROL = 'public, max-age=31536000, immutable';

interface CheckedLogo {
  bytes: Uint8Array;
  ext: SponsorLogoExt;
  width: number;
  height: number;
}

/** @throws SponsorLogoInvalidError */
function checkLogo(logo: SponsorLogoUpload): CheckedLogo {
  const result = inspectLogo(logo.bytes, logo.contentType);
  if (!result.ok) throw new SponsorLogoInvalidError(result.reason);
  return { bytes: logo.bytes, ext: result.ext, width: result.width, height: result.height };
}

/**
 * Inserts `id` into a level's `order` at `requested`, clamped to 1…n+1
 * (the end when omitted), and returns the position it got. `order` is then
 * the level's full new order, ready for `renumber`.
 */
function placeIn(order: string[], id: string, requested: number | undefined): number {
  const end = order.length + 1;
  const position =
    requested === undefined || !Number.isInteger(requested)
      ? end
      : Math.min(Math.max(requested, 1), end);
  order.splice(position - 1, 0, id);
  return position;
}

function fields(input: SponsorInput) {
  return {
    name: input.name,
    websiteUrl: input.websiteUrl,
    level: input.level,
    tileTone: input.tileTone,
    active: input.active,
  };
}

export function createSponsorsService({
  sponsors,
  storage,
  runInTransaction,
  now = () => new Date(),
  newId = randomUUID,
  logger = defaultLogger,
}: SponsorsServiceDeps) {
  /** Outside any transaction (Invariant 7). Resolves the new key. */
  async function storeLogo(sponsorId: string, logo: CheckedLogo): Promise<string> {
    const key = sponsorLogoKey(sponsorId, logo.ext);
    await storage.put({
      key,
      body: logo.bytes,
      contentType: CONTENT_TYPE[logo.ext],
      // Opening the URL directly downloads the file instead of rendering
      // it; an <img> still displays it (plan decision 1).
      contentDisposition: 'attachment',
      cacheControl: LOGO_CACHE_CONTROL,
    });
    return key;
  }

  // An orphaned object costs a few KB; a failed delete must never undo a
  // committed change (or mask the error that caused it), so it is logged.
  async function bestEffortDelete(key: string): Promise<void> {
    try {
      await storage.delete(key);
    } catch (err: unknown) {
      logger.warn({ key, err }, 'sponsors.service: could not delete logo object');
    }
  }

  async function get(id: string): Promise<SponsorRecord> {
    const row = await sponsors.findById(id);
    if (!row) throw new SponsorNotFoundError(id);
    return row;
  }

  function logoUrl(row: Pick<SponsorRecord, 'logoKey'>): string {
    return storage.publicUrl(row.logoKey);
  }

  function logDemoted(demoted: SponsorRecord | null, actor: string): void {
    if (!demoted) return;
    logger.info(
      { actor, sponsorId: demoted.id, name: demoted.name },
      'sponsor demoted to partner #1',
    );
  }

  return {
    /** @throws SponsorNotFoundError */
    get,

    async listForAdmin(): Promise<AdminSponsorGroup[]> {
      const rows = await sponsors.listAll();
      return LEVELS.map((level) => ({
        level,
        sponsors: rows.filter((r) => r.level === level).map((r) => ({ ...r, logoUrl: logoUrl(r) })),
      }));
    },

    /** Active sponsors, presenting → partner → supporter, each level in its order. */
    async listPublic(): Promise<PublicSponsor[]> {
      const rows = await sponsors.listActive();
      return rows.map((r) => ({
        id: r.id,
        name: r.name,
        websiteUrl: r.websiteUrl,
        level: r.level,
        tileTone: r.tileTone,
        logoUrl: logoUrl(r),
        logoWidth: r.logoWidth,
        logoHeight: r.logoHeight,
      }));
    },

    /**
     * Saving a presenting partner moves the current one to Partner #1 in
     * the same transaction.
     * @throws SponsorLogoInvalidError, SponsorPresentingConflictError
     */
    async create(input: CreateSponsorInput, actor: string): Promise<SponsorRecord> {
      // Checked before anything is stored: a refused logo never reaches storage.
      const logo = checkLogo(input.logo);
      const id = newId();
      const logoKey = await storeLogo(id, logo);

      let saved: { row: SponsorRecord; demoted: SponsorRecord | null };
      try {
        saved = await runInTransaction(async (tx) => {
          await sponsors.lock(tx);
          const at = now();
          const demoted =
            input.level === 'presenting' ? await sponsors.demotePresenting(null, at, tx) : null;
          const order = await sponsors.listIdsByLevel(input.level, tx);
          const position = placeIn(order, id, input.position);
          const row = await sponsors.insert(
            {
              id,
              ...fields(input),
              logoKey,
              logoWidth: logo.width,
              logoHeight: logo.height,
              position,
              createdAt: at,
              updatedAt: at,
            },
            tx,
          );
          await sponsors.renumber(order, tx);
          return { row, demoted };
        });
      } catch (err: unknown) {
        await bestEffortDelete(logoKey);
        throw err;
      }

      logDemoted(saved.demoted, actor);
      logger.info(
        { actor, sponsorId: id, name: saved.row.name, level: saved.row.level },
        'sponsor created',
      );
      return saved.row;
    },

    /**
     * Moving to another level closes the gap left behind; a new logo
     * replaces the old one, which is deleted after commit.
     * @throws SponsorNotFoundError, SponsorLogoInvalidError, SponsorPresentingConflictError
     */
    async update(id: string, input: UpdateSponsorInput, actor: string): Promise<SponsorRecord> {
      const logo = input.logo ? checkLogo(input.logo) : null;
      // Before uploading: an unknown id must not leave an object behind.
      await get(id);
      const logoKey = logo ? await storeLogo(id, logo) : null;

      let saved: { row: SponsorRecord; replacedKey: string | null; demoted: SponsorRecord | null };
      try {
        saved = await runInTransaction(async (tx) => {
          await sponsors.lock(tx);
          const current = await sponsors.findById(id, tx);
          if (!current) throw new SponsorNotFoundError(id);
          const at = now();
          const demoted =
            input.level === 'presenting' ? await sponsors.demotePresenting(id, at, tx) : null;
          const order = (await sponsors.listIdsByLevel(input.level, tx)).filter((x) => x !== id);
          const sameLevel = current.level === input.level;
          const position = placeIn(
            order,
            id,
            input.position ?? (sameLevel ? current.position : undefined),
          );
          const row = await sponsors.update(
            id,
            {
              ...fields(input),
              ...(logo && logoKey
                ? { logoKey, logoWidth: logo.width, logoHeight: logo.height }
                : {}),
              position,
              updatedAt: at,
            },
            tx,
          );
          if (!row) throw new SponsorNotFoundError(id);
          await sponsors.renumber(order, tx);
          if (!sameLevel) {
            // Close the gap it left in its old level.
            await sponsors.renumber(await sponsors.listIdsByLevel(current.level, tx), tx);
          }
          return { row, replacedKey: logoKey ? current.logoKey : null, demoted };
        });
      } catch (err: unknown) {
        if (logoKey) await bestEffortDelete(logoKey);
        throw err;
      }

      if (saved.replacedKey) await bestEffortDelete(saved.replacedKey);
      logDemoted(saved.demoted, actor);
      logger.info(
        { actor, sponsorId: id, name: saved.row.name, level: saved.row.level },
        'sponsor updated',
      );
      return saved.row;
    },

    /** @throws SponsorNotFoundError */
    async setActive(id: string, active: boolean, actor: string): Promise<SponsorRecord> {
      const row = await runInTransaction(async (tx) => {
        await sponsors.lock(tx);
        return sponsors.update(id, { active, updatedAt: now() }, tx);
      });
      if (!row) throw new SponsorNotFoundError(id);
      logger.info({ actor, sponsorId: id, name: row.name, active }, 'sponsor switched');
      return row;
    },

    /**
     * The one ordering primitive: ▲ and ▼ call it with position ± 1.
     * Clamped to 1…n, so moving the first one up is a no-op.
     * @throws SponsorNotFoundError
     */
    async setPosition(id: string, position: number, actor: string): Promise<SponsorRecord> {
      const moved = await runInTransaction(async (tx) => {
        await sponsors.lock(tx);
        const current = await sponsors.findById(id, tx);
        if (!current) throw new SponsorNotFoundError(id);
        const order = (await sponsors.listIdsByLevel(current.level, tx)).filter((x) => x !== id);
        const placed = placeIn(order, id, position);
        await sponsors.renumber(order, tx);
        return { from: current.position, row: { ...current, position: placed } };
      });
      logger.info(
        { actor, sponsorId: id, name: moved.row.name, from: moved.from, to: moved.row.position },
        'sponsor moved',
      );
      return moved.row;
    },

    /** The logo object is removed after commit, best-effort. @throws SponsorNotFoundError */
    async delete(id: string, actor: string): Promise<void> {
      const row = await runInTransaction(async (tx) => {
        await sponsors.lock(tx);
        const deleted = await sponsors.delete(id, tx);
        if (!deleted) throw new SponsorNotFoundError(id);
        await sponsors.renumber(await sponsors.listIdsByLevel(deleted.level, tx), tx);
        return deleted;
      });
      await bestEffortDelete(row.logoKey);
      logger.info({ actor, sponsorId: id, name: row.name }, 'sponsor deleted');
    },
  };
}

export type SponsorsService = ReturnType<typeof createSponsorsService>;
