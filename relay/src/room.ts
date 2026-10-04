/**
 * ADR-058: one event's room — the rules, apart from Cloudflare's APIs so
 * they are tested in plain Node. The Durable Object (index.ts) feeds it
 * messages and does what it returns.
 *
 * The room is a relay, never a judge: Postgres decides every check-in. It
 * only spreads "ticket X is in" between door phones — within a fraction of
 * a second, and still when our server is down.
 *
 * Rows, per ticket:
 * - a **claim**: a phone says it let someone in (it may be offline). It
 *   belongs to that phone's PASS — never a gate name, which two passes can
 *   share — and only that pass may take it back, only while unconfirmed.
 * - **confirmed**: our server announced the check-in after its commit. It
 *   replaces a claim; no phone can remove it. Only the server's undo can,
 *   and only for the check-in it undid (by time): a stale or retried undo
 *   never removes a re-admit.
 * - a **tombstone**: a check-in taken back. Kept (with its own seq) so a
 *   phone that was away hears the undo when it catches up.
 *
 * Every change gets the next `seq`; a phone resumes with "after seq N of
 * room epoch E" — never by a time a phone controls, and never across a
 * rebuilt room.
 */

/** A row as the phones get it. */
export interface RoomCheckIn {
  ticketId: string;
  /** ISO 8601. */
  at: string;
  /** The gate's name; null when the admin or the server did it. */
  gate: string | null;
  /** Our server has it (it announced it); false for a phone's claim. */
  confirmed: boolean;
  seq: number;
}

export interface StoredCheckIn {
  ticketId: string;
  /** The check-in's time; for a tombstone, the time of the check-in undone. */
  atMs: number;
  gate: string | null;
  /** The pass that claimed it; null once the server confirmed it. */
  passId: string | null;
  confirmed: boolean;
  seq: number;
  /** A tombstone: who took it back. Null for a standing check-in. */
  removed: 'gate' | 'server' | null;
}

export interface RoomStore {
  /** The row for a ticket, tombstones included. */
  get(ticketId: string): StoredCheckIn | null;
  /** Insert or replace. */
  put(row: StoredCheckIn): void;
  /** Rows (tombstones included) changed after `seq`, in seq order, at most `limit`. */
  after(seq: number, limit: number): StoredCheckIn[];
  /** Standing, unconfirmed claims of one pass. */
  claimsOf(passId: string): StoredCheckIn[];
  /**
   * Every row a pass created and the server has not taken over — tombstones
   * of its own undos included, so claim/undo churn cannot grow the room.
   */
  rowsOf(passId: string): number;
  /** All rows, tombstones included. */
  count(): number;
  /** The next sequence number (persisted). */
  nextSeq(): number;
  /** The last one handed out (0 for a new room). */
  topSeq(): number;
  /** This room's identity: new whenever the room is (re)built. */
  epoch(): string;
  isRevoked(passId: string): boolean;
  revoke(passId: string): void;
}

/** Room → phone. */
export type RoomMessage =
  /** First on every connect: which room this is, so a cursor never crosses a rebuild. */
  | { t: 'hello'; epoch: string; top: number }
  | { t: 'checkins'; rows: RoomCheckIn[] }
  /**
   * A check-in taken back: by the pass that claimed it (`by: 'gate'`), or
   * by the server (`by: 'server'`) — `at` is the time of the check-in undone.
   */
  | { t: 'undo'; ticketId: string; by: 'gate' | 'server'; at: string; seq: number };

/** Who sent a phone message: from its verified pass, never from the message. */
export interface Sender {
  passId: string;
  gate: string;
}

export type RoomAction =
  /** A malformed or oversized message: the sender is closed. */
  | { kind: 'reject'; reason: string }
  | {
      kind: 'ok';
      /** To every phone in the room, except the sending socket when `skipSender`. */
      broadcast: RoomMessage[];
      skipSender: boolean;
      /** Close every socket of this pass (revoked). */
      closePass?: string;
      /** Keep the room (and its revocations) at least until then (ms). */
      keepUntil?: number;
      /** Something the operator should see in the relay's logs. */
      warn?: string;
    };

/** A single phone message larger than this is not one of ours. */
export const MAX_MESSAGE_BYTES = 1024;
/** A batch of re-sent claims (`t: 'claims'`) — one message, one rate unit. */
export const MAX_BATCH_BYTES = 32 * 1024;
export const MAX_BATCH_ITEMS = 300;
/** Rows per catch-up message; a catch-up sends as many messages as it needs. */
export const BACKLOG_PAGE = 1000;
/** Claims stop being stored past this many rows in all (the server's never do). */
export const ROOM_CAP = 20_000;
/** Rows one pass may create (claims and their undos): more than a gate admits in a night. */
export const PASS_CLAIM_CAP = 2_000;
/** A claim this much newer than an undone check-in is a re-admit, not that check-in. */
export const UNDO_SLACK_MS = 5_000;
/** A phone's clock (corrected) may be this far off the relay's. */
const FUTURE_SLACK_MS = 5 * 60_000;
const PAST_LIMIT_MS = 36 * 3_600_000;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

const NOTHING: Extract<RoomAction, { kind: 'ok' }> = {
  kind: 'ok',
  broadcast: [],
  skipSender: false,
};

const iso = (ms: number) => new Date(ms).toISOString();
const standing = (row: StoredCheckIn | null): row is StoredCheckIn => !!row && !row.removed;

export function wire(row: StoredCheckIn): RoomCheckIn {
  return {
    ticketId: row.ticketId,
    at: iso(row.atMs),
    gate: row.gate,
    confirmed: row.confirmed,
    seq: row.seq,
  };
}

function undoMessage(row: StoredCheckIn): RoomMessage {
  return {
    t: 'undo',
    ticketId: row.ticketId,
    by: row.removed ?? 'server',
    at: iso(row.atMs),
    seq: row.seq,
  };
}

/** Many messages as one: rows into a single `checkins`, undos as they are. */
function merge(messages: RoomMessage[]): RoomMessage[] {
  const rows: RoomCheckIn[] = [];
  const rest: RoomMessage[] = [];
  for (const m of messages) {
    if (m.t === 'checkins') rows.push(...m.rows);
    else rest.push(m);
  }
  return [...(rows.length ? [{ t: 'checkins' as const, rows }] : []), ...rest];
}

export function createRoom(store: RoomStore, now: () => number = Date.now) {
  function plausibleTime(atMs: unknown): atMs is number {
    if (typeof atMs !== 'number' || !Number.isFinite(atMs)) return false;
    const t = now();
    return atMs <= t + FUTURE_SLACK_MS && atMs >= t - PAST_LIMIT_MS;
  }

  /** A phone's own admit; null for a malformed item. */
  function claim(sender: Sender, ticketId: unknown, at: unknown): RoomAction | null {
    if (typeof ticketId !== 'string' || !UUID.test(ticketId) || !plausibleTime(at)) return null;
    // The first word on a ticket stands; a resent claim is the same fact.
    if (standing(store.get(ticketId))) return NOTHING;
    if (store.count() >= ROOM_CAP) return NOTHING;
    if (store.rowsOf(sender.passId) >= PASS_CLAIM_CAP) {
      return { ...NOTHING, warn: `pass ${sender.passId} reached ${PASS_CLAIM_CAP} rows` };
    }
    const row: StoredCheckIn = {
      ticketId,
      atMs: at,
      gate: sender.gate,
      passId: sender.passId,
      confirmed: false,
      seq: store.nextSeq(),
      removed: null,
    };
    store.put(row);
    return { kind: 'ok', broadcast: [{ t: 'checkins', rows: [wire(row)] }], skipSender: true };
  }

  /** A phone taking back its own claim; null for a malformed item. */
  function unclaim(sender: Sender, ticketId: unknown): RoomAction | null {
    if (typeof ticketId !== 'string' || !UUID.test(ticketId)) return null;
    // Only this pass's own claim, and only before the server has it.
    const row = store.get(ticketId);
    if (!standing(row) || row.confirmed || row.passId !== sender.passId) return NOTHING;
    const tomb: StoredCheckIn = { ...row, removed: 'gate', seq: store.nextSeq() };
    store.put(tomb);
    return { kind: 'ok', broadcast: [undoMessage(tomb)], skipSender: true };
  }

  return {
    /**
     * What a phone missed: a `hello` naming this room, then every row and
     * undo after `afterSeq` — from the start when the phone's cursor is of
     * another room (a rebuilt one) or past this room's last seq.
     */
    backlog(afterSeq: number, epoch: string | null): RoomMessage[] {
      const top = store.topSeq();
      const from = epoch !== store.epoch() || afterSeq > top ? 0 : afterSeq;
      const out: RoomMessage[] = [{ t: 'hello', epoch: store.epoch(), top }];
      let cursor = from;
      for (;;) {
        const page = store.after(cursor, BACKLOG_PAGE);
        if (page.length === 0) break;
        const rows = page.filter((r) => !r.removed).map(wire);
        if (rows.length) out.push({ t: 'checkins', rows });
        for (const r of page) if (r.removed) out.push(undoMessage(r));
        cursor = page[page.length - 1]!.seq;
        if (page.length < BACKLOG_PAGE) break;
      }
      return out;
    },

    isRevoked(passId: string): boolean {
      return store.isRevoked(passId);
    },

    /**
     * A phone's own admit (`in`), its own undo (`undo`), or a batch of them
     * re-sent when its link opens (`claims`: one message, one rate unit).
     */
    fromPhone(sender: Sender, raw: string): RoomAction {
      if (raw.length > MAX_BATCH_BYTES) return { kind: 'reject', reason: 'too large' };
      let msg: unknown;
      try {
        msg = JSON.parse(raw);
      } catch {
        return { kind: 'reject', reason: 'not JSON' };
      }
      if (typeof msg !== 'object' || msg === null) {
        return { kind: 'reject', reason: 'not an object' };
      }
      const m = msg as Record<string, unknown>;

      if (m.t === 'claims') {
        if (!Array.isArray(m.items) || m.items.length > MAX_BATCH_ITEMS) {
          return { kind: 'reject', reason: 'bad batch' };
        }
        const broadcast: RoomMessage[] = [];
        let warn: string | undefined;
        for (const item of m.items) {
          if (typeof item !== 'object' || item === null) continue;
          const i = item as Record<string, unknown>;
          const action =
            i.t === 'in'
              ? claim(sender, i.ticketId, i.at)
              : i.t === 'undo'
                ? unclaim(sender, i.ticketId)
                : null;
          if (action?.kind === 'ok') {
            broadcast.push(...action.broadcast);
            warn ??= action.warn;
          }
        }
        return {
          kind: 'ok',
          broadcast: merge(broadcast),
          skipSender: true,
          ...(warn ? { warn } : {}),
        };
      }

      if (raw.length > MAX_MESSAGE_BYTES) return { kind: 'reject', reason: 'too large' };
      if (m.t === 'in')
        return claim(sender, m.ticketId, m.at) ?? { kind: 'reject', reason: 'bad claim' };
      if (m.t === 'undo')
        return unclaim(sender, m.ticketId) ?? { kind: 'reject', reason: 'bad undo' };
      return { kind: 'reject', reason: 'unknown message' };
    },

    /** Our server, after a commit: a check-in, an undo, or a revoked pass. Null: a bad body. */
    fromServer(body: unknown): RoomAction | null {
      if (typeof body !== 'object' || body === null) return null;
      const b = body as Record<string, unknown>;

      if (b.kind === 'revoke') {
        if (typeof b.passId !== 'string' || !UUID.test(b.passId)) return null;
        const until = typeof b.until === 'string' ? Date.parse(b.until) : Number.NaN;
        store.revoke(b.passId);
        // What that pass claimed and the server never confirmed goes too.
        const broadcast = store.claimsOf(b.passId).map((row) => {
          const tomb: StoredCheckIn = { ...row, removed: 'gate', seq: store.nextSeq() };
          store.put(tomb);
          return undoMessage(tomb);
        });
        return {
          kind: 'ok',
          broadcast,
          skipSender: false,
          closePass: b.passId,
          // The revocation must outlive every copy of that pass's token.
          ...(Number.isFinite(until) ? { keepUntil: until } : {}),
        };
      }

      if (typeof b.ticketId !== 'string' || !UUID.test(b.ticketId)) return null;
      const atMs = typeof b.at === 'string' ? Date.parse(b.at) : Number.NaN;
      if (!Number.isFinite(atMs)) return null;
      const existing = store.get(b.ticketId);

      if (b.kind === 'in') {
        // A retried announcement of what the room already has: nothing new.
        if (standing(existing) && existing.confirmed && existing.atMs === atMs) return NOTHING;
        // An announcement of a check-in the server has since undone (it
        // arrived late, or again): the undo stands.
        if (existing?.removed === 'server' && existing.atMs >= atMs) return NOTHING;
        const row: StoredCheckIn = {
          ticketId: b.ticketId,
          atMs,
          gate: typeof b.gate === 'string' && b.gate.length > 0 ? b.gate : null,
          passId: null,
          confirmed: true,
          seq: store.nextSeq(),
          removed: null,
        };
        // The server's word replaces a phone's claim; no cap applies to it.
        store.put(row);
        return { kind: 'ok', broadcast: [{ t: 'checkins', rows: [wire(row)] }], skipSender: false };
      }

      if (b.kind === 'undo') {
        if (standing(existing)) {
          // Not the check-in undone: a re-admit since (S4), or a claim made
          // after it (a retried undo must not erase a new offline admit).
          if (existing.confirmed && existing.atMs !== atMs) return NOTHING;
          if (!existing.confirmed && existing.atMs > atMs + UNDO_SLACK_MS) return NOTHING;
        }
        // Tombstoned even with no row here: phones may hold the check-in
        // from their ping or list, and a phone away now hears it on return.
        const tomb: StoredCheckIn = {
          ticketId: b.ticketId,
          atMs,
          gate: existing?.gate ?? null,
          passId: null,
          confirmed: true,
          seq: store.nextSeq(),
          removed: 'server',
        };
        store.put(tomb);
        return { kind: 'ok', broadcast: [undoMessage(tomb)], skipSender: false };
      }
      return null;
    },
  };
}

export type Room = ReturnType<typeof createRoom>;
