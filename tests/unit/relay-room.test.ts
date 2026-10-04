import { describe, expect, it } from 'vitest';
import {
  BACKLOG_PAGE,
  MAX_BATCH_ITEMS,
  MAX_MESSAGE_BYTES,
  PASS_CLAIM_CAP,
  ROOM_CAP,
  type RoomAction,
  type RoomMessage,
  type RoomStore,
  type StoredCheckIn,
  UNDO_SLACK_MS,
  createRoom,
} from '../../relay/src/room';

const NOW = Date.parse('2026-10-10T18:00:00Z');
const T1 = 'a1a1a1a1-1111-4111-8111-111111111111';
const T2 = 'b2b2b2b2-2222-4222-8222-222222222222';
const PASS_A = '0a0a0a0a-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const PASS_A2 = '0c0c0c0c-cccc-4ccc-8ccc-cccccccccccc';
const PASS_B = '0b0b0b0b-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const gateA = { passId: PASS_A, gate: 'Gate A' };
/** Another pass that happens to have the same gate name. */
const gateA2 = { passId: PASS_A2, gate: 'Gate A' };
const gateB = { passId: PASS_B, gate: 'Gate B' };
const iso = (ms: number) => new Date(ms).toISOString();
const ticket = (i: number) => `${i.toString(16).padStart(8, '0')}-0000-4000-8000-000000000000`;

/** The Durable Object's SQLite, in memory. */
function memoryStore(epoch = 'epoch-1'): RoomStore & { rows: Map<string, StoredCheckIn> } {
  const rows = new Map<string, StoredCheckIn>();
  const revoked = new Set<string>();
  let seq = 0;
  return {
    rows,
    get: (id) => rows.get(id) ?? null,
    put: (r) => {
      rows.set(r.ticketId, r);
    },
    after: (s, limit) =>
      [...rows.values()]
        .filter((r) => r.seq > s)
        .sort((a, b) => a.seq - b.seq)
        .slice(0, limit),
    claimsOf: (passId) =>
      [...rows.values()].filter((r) => r.passId === passId && !r.confirmed && !r.removed),
    rowsOf: (passId) => [...rows.values()].filter((r) => r.passId === passId).length,
    count: () => rows.size,
    nextSeq: () => ++seq,
    topSeq: () => seq,
    epoch: () => epoch,
    isRevoked: (id) => revoked.has(id),
    revoke: (id) => {
      revoked.add(id);
    },
  };
}

const room = (store = memoryStore()) => ({ store, room: createRoom(store, () => NOW) });
const msg = (m: unknown) => JSON.stringify(m);
const phoneIn = (ticketId: string, at = NOW) => msg({ t: 'in', ticketId, at });
const phoneUndo = (ticketId: string) => msg({ t: 'undo', ticketId });
const serverIn = (ticketId: string, at: number, gate: string | null = 'Gate A') => ({
  kind: 'in',
  ticketId,
  at: iso(at),
  gate,
});
const serverUndo = (ticketId: string, at: number) => ({ kind: 'undo', ticketId, at: iso(at) });
const nothing: RoomAction = { kind: 'ok', broadcast: [], skipSender: false };
const standing = (store: { rows: Map<string, StoredCheckIn> }) =>
  [...store.rows.values()].filter((r) => !r.removed).map((r) => r.ticketId);

describe('relay room: claims and the server', () => {
  it("a phone's admit is a claim of its pass, named by the pass's gate, for every other socket", () => {
    const { room: r, store } = room();
    const action = r.fromPhone(
      gateA,
      msg({ t: 'in', ticketId: T1, at: NOW - 1000, gate: 'Gate Z' }),
    );
    expect(action).toEqual({
      kind: 'ok',
      skipSender: true,
      broadcast: [
        {
          t: 'checkins',
          rows: [{ ticketId: T1, at: iso(NOW - 1000), gate: 'Gate A', confirmed: false, seq: 1 }],
        },
      ],
    });
    expect(store.rows.get(T1)).toMatchObject({ passId: PASS_A, confirmed: false, removed: null });
  });

  it('the first claim stands: another claim, or a resent one, changes nothing', () => {
    const { room: r } = room();
    r.fromPhone(gateA, phoneIn(T1));
    expect(r.fromPhone(gateB, phoneIn(T1))).toEqual(nothing);
    expect(r.fromPhone(gateA, phoneIn(T1))).toEqual(nothing);
  });

  it("the server's check-in confirms a claim, replacing it, and every phone hears it", () => {
    const { room: r, store } = room();
    r.fromPhone(gateA, phoneIn(T1, NOW - 5000));
    expect(r.fromServer(serverIn(T1, NOW - 4000))).toEqual({
      kind: 'ok',
      skipSender: false,
      broadcast: [
        {
          t: 'checkins',
          rows: [{ ticketId: T1, at: iso(NOW - 4000), gate: 'Gate A', confirmed: true, seq: 2 }],
        },
      ],
    });
    expect(store.rows.get(T1)).toMatchObject({ passId: null, confirmed: true });
    // A retried announcement of the same check-in: nothing new.
    expect(r.fromServer(serverIn(T1, NOW - 4000))).toEqual(nothing);
  });

  it("an admin's check-in has no gate", () => {
    const { room: r } = room();
    expect(r.fromServer(serverIn(T2, NOW, null))).toMatchObject({
      broadcast: [{ rows: [{ gate: null, confirmed: true }] }],
    });
  });
});

describe('relay room: a gate taking back its claim (B1)', () => {
  it('a pass takes back its own unconfirmed claim, and the other phones hear it', () => {
    const { room: r, store } = room();
    r.fromPhone(gateA, phoneIn(T1));
    expect(r.fromPhone(gateA, phoneUndo(T1))).toEqual({
      kind: 'ok',
      skipSender: true,
      broadcast: [{ t: 'undo', ticketId: T1, by: 'gate', at: iso(NOW), seq: 2 }],
    });
    expect(standing(store)).toEqual([]);
  });

  it('another pass with the SAME gate name cannot take it back', () => {
    const { room: r, store } = room();
    r.fromPhone(gateA, phoneIn(T1));
    expect(r.fromPhone(gateA2, phoneUndo(T1))).toEqual(nothing);
    expect(r.fromPhone(gateB, phoneUndo(T1))).toEqual(nothing);
    expect(standing(store)).toEqual([T1]);
  });

  it('once the server confirmed it, no phone can remove it — not even the one that claimed it', () => {
    const { room: r, store } = room();
    r.fromPhone(gateA, phoneIn(T1));
    r.fromServer(serverIn(T1, NOW));
    expect(r.fromPhone(gateA, phoneUndo(T1))).toEqual(nothing);
    // A stolen pass sweeping every ticket id: the server's rows stay.
    r.fromServer(serverIn(T2, NOW, 'Gate A'));
    expect(r.fromPhone(gateA, phoneUndo(T2))).toEqual(nothing);
    expect(standing(store).sort()).toEqual([T1, T2]);
  });
});

describe("relay room: the server's undo (S4, S-B)", () => {
  it('removes the check-in it undid, and tells every phone with its time', () => {
    const { room: r, store } = room();
    r.fromServer(serverIn(T1, NOW - 9000));
    expect(r.fromServer(serverUndo(T1, NOW - 9000))).toEqual({
      kind: 'ok',
      skipSender: false,
      broadcast: [{ t: 'undo', ticketId: T1, by: 'server', at: iso(NOW - 9000), seq: 2 }],
    });
    expect(standing(store)).toEqual([]);
  });

  it('a late undo of an OLD check-in leaves a re-admit standing', () => {
    const { room: r, store } = room();
    r.fromServer(serverIn(T1, NOW + 1000));
    expect(r.fromServer(serverUndo(T1, NOW - 60_000))).toEqual(nothing);
    expect(store.rows.get(T1)).toMatchObject({ confirmed: true, atMs: NOW + 1000, removed: null });
  });

  it('a retried undo leaves a NEWER offline claim standing; an older claim goes', () => {
    const { room: r, store } = room();
    // Undo of the 17:00 check-in, retried after gate B admitted offline at 18:00.
    r.fromPhone(gateB, phoneIn(T1, NOW));
    expect(r.fromServer(serverUndo(T1, NOW - 3_600_000))).toEqual(nothing);
    expect(standing(store)).toEqual([T1]);
    // A claim from before the undone check-in (within the slack) is that check-in.
    expect(r.fromServer(serverUndo(T1, NOW - UNDO_SLACK_MS))).toMatchObject({
      broadcast: [{ t: 'undo', by: 'server' }],
    });
    expect(standing(store)).toEqual([]);
  });

  it('a stale announcement of a check-in the server already undid does not bring it back', () => {
    const { room: r, store } = room();
    r.fromServer(serverIn(T1, NOW - 9000));
    r.fromServer(serverUndo(T1, NOW - 9000));
    expect(r.fromServer(serverIn(T1, NOW - 9000))).toEqual(nothing);
    expect(standing(store)).toEqual([]);
    // A genuine re-admit later is a new check-in.
    expect(r.fromServer(serverIn(T1, NOW))).toMatchObject({ broadcast: [{ t: 'checkins' }] });
  });

  it('speaks even when the room never heard of the check-in: phones may hold it from their ping', () => {
    const { room: r } = room();
    expect(r.fromServer(serverUndo(T2, NOW))).toMatchObject({
      broadcast: [{ t: 'undo', ticketId: T2, by: 'server', at: iso(NOW) }],
    });
  });
});

describe('relay room: revoke (S6, S-A)', () => {
  it("closes the pass, keeps it out, takes back its claims — never the server's rows — and keeps the room until the pass would expire", () => {
    const { room: r, store } = room();
    r.fromPhone(gateB, phoneIn(T1));
    r.fromPhone(gateB, phoneIn(T2));
    r.fromServer(serverIn(T2, NOW, 'Gate B'));
    const until = NOW + 13 * 3_600_000;
    expect(r.fromServer({ kind: 'revoke', passId: PASS_B, until: iso(until) })).toEqual({
      kind: 'ok',
      skipSender: false,
      closePass: PASS_B,
      keepUntil: until,
      broadcast: [{ t: 'undo', ticketId: T1, by: 'gate', at: iso(NOW), seq: 4 }],
    });
    expect(r.isRevoked(PASS_B)).toBe(true);
    expect(r.isRevoked(PASS_A)).toBe(false);
    expect(standing(store)).toEqual([T2]);
  });
});

describe('relay room: catching up (S2, S-C, S-D)', () => {
  const rowsOf = (messages: RoomMessage[]) =>
    messages.flatMap((m) => (m.t === 'checkins' ? m.rows.map((r) => r.ticketId) : []));
  const undosOf = (messages: RoomMessage[]) =>
    messages.flatMap((m) => (m.t === 'undo' ? [m.ticketId] : []));

  it('names the room first, then every row changed after the cursor — never by a phone-set time', () => {
    const { room: r } = room();
    r.fromPhone(gateA, phoneIn(T1, NOW + 4 * 60_000)); // a clock 4 minutes fast: seq 1
    r.fromPhone(gateB, phoneIn(T2, NOW - 3_600_000)); // a late offline admit: seq 2
    const back = r.backlog(1, 'epoch-1');
    expect(back[0]).toEqual({ t: 'hello', epoch: 'epoch-1', top: 2 });
    expect(rowsOf(back)).toEqual([T2]);
    expect(rowsOf(r.backlog(0, 'epoch-1'))).toEqual([T1, T2]);
  });

  it('a phone that was away hears the undos it missed', () => {
    const { room: r } = room();
    r.fromPhone(gateB, phoneIn(T1));
    r.fromPhone(gateB, phoneIn(T2));
    const cursor = 2;
    r.fromServer({ kind: 'revoke', passId: PASS_B, until: iso(NOW) });
    const back = r.backlog(cursor, 'epoch-1');
    expect(undosOf(back).sort()).toEqual([T1, T2].sort());
    expect(rowsOf(back)).toEqual([]);
  });

  it("a cursor of another room (rebuilt), or past this room's end, starts from the beginning", () => {
    const { room: r } = room();
    r.fromPhone(gateA, phoneIn(T1));
    expect(rowsOf(r.backlog(800, 'an-older-epoch'))).toEqual([T1]);
    expect(rowsOf(r.backlog(0, null))).toEqual([T1]);
    expect(rowsOf(r.backlog(999, 'epoch-1'))).toEqual([T1]);
  });

  it('sends a big room in pages, all of it', () => {
    const store = memoryStore();
    const total = BACKLOG_PAGE * 2 + 5;
    for (let i = 0; i < total; i++) {
      store.put({
        ticketId: ticket(i),
        atMs: NOW,
        gate: null,
        passId: null,
        confirmed: true,
        seq: store.nextSeq(),
        removed: null,
      });
    }
    const back = room(store).room.backlog(0, 'epoch-1');
    expect(back.filter((m) => m.t === 'checkins')).toHaveLength(3);
    expect(rowsOf(back)).toHaveLength(total);
  });
});

describe('relay room: re-sent claims and limits (B-1, S5)', () => {
  it('takes a whole batch of re-sent claims as one message — more than a rate window allows one by one', () => {
    const { room: r, store } = room();
    const items = Array.from({ length: 250 }, (_, i) => ({
      t: 'in',
      ticketId: ticket(i),
      at: NOW,
    }));
    const action = r.fromPhone(gateA, msg({ t: 'claims', items }));
    expect(action.kind).toBe('ok');
    expect(store.count()).toBe(250);
    // One checkins message for the lot.
    expect(action).toMatchObject({ skipSender: true, broadcast: [{ t: 'checkins' }] });
    // Re-sent again (a reconnect): nothing new, nothing refused.
    expect(r.fromPhone(gateA, msg({ t: 'claims', items }))).toEqual({
      kind: 'ok',
      broadcast: [],
      skipSender: true,
    });
  });

  it('a batch mixes claims and undos, skips bad items, and has a size limit', () => {
    const { room: r, store } = room();
    r.fromPhone(gateA, phoneIn(T2));
    r.fromPhone(
      gateA,
      msg({
        t: 'claims',
        items: [{ t: 'in', ticketId: T1, at: NOW }, { t: 'undo', ticketId: T2 }, { t: 'in' }, 7],
      }),
    );
    expect(standing(store)).toEqual([T1]);
    const tooMany = Array.from({ length: MAX_BATCH_ITEMS + 1 }, () => ({
      t: 'undo',
      ticketId: T1,
    }));
    expect(r.fromPhone(gateA, msg({ t: 'claims', items: tooMany })).kind).toBe('reject');
  });

  it('claim-and-undo churn by one pass stops at its cap: its tombstones count too', () => {
    const { room: r, store } = room();
    const churn = Array.from({ length: 150 }, (_, i) => ticket(i)).flatMap((id) => [
      { t: 'in', ticketId: id, at: NOW },
      { t: 'undo', ticketId: id },
    ]);
    for (let round = 0; round < 40; round++) {
      // New fake ids each round, so nothing repeats.
      const items = churn.map((m) => ({
        ...m,
        ticketId: ticket(round * 1000 + Number.parseInt(m.ticketId.slice(0, 8), 16)),
      }));
      r.fromPhone(gateA, msg({ t: 'claims', items }));
    }
    expect(store.rowsOf(PASS_A)).toBe(PASS_CLAIM_CAP);
    expect(store.count()).toBe(PASS_CLAIM_CAP);
    // Another gate is unaffected.
    expect(r.fromPhone(gateB, phoneIn(T1)).kind).toBe('ok');
  });

  it('rejects what is not ours: junk, a big message, a bad id, an impossible time', () => {
    const { room: r, store } = room();
    const rejected = (raw: string) => expect(r.fromPhone(gateA, raw).kind).toBe('reject');
    rejected('not json');
    rejected('"a string"');
    rejected(msg({ t: 'in', ticketId: T1, at: NOW, pad: 'x'.repeat(MAX_MESSAGE_BYTES) }));
    rejected(msg({ t: 'in', ticketId: 'DROP TABLE', at: NOW }));
    rejected(msg({ t: 'in', ticketId: T1, at: NOW + 3_600_000 }));
    rejected(msg({ t: 'in', ticketId: T1, at: NOW - 48 * 3_600_000 }));
    rejected(msg({ t: 'in', ticketId: T1, at: 'soon' }));
    rejected(msg({ t: 'shout', ticketId: T1 }));
    expect(store.count()).toBe(0);
    expect(r.fromServer({ kind: 'in', ticketId: T1, at: 'nope' })).toBeNull();
    expect(r.fromServer({ kind: 'undo', ticketId: T1 })).toBeNull();
    expect(r.fromServer({ kind: 'revoke', passId: 'x' })).toBeNull();
    expect(r.fromServer('junk')).toBeNull();
  });

  it('one pass cannot flood the room (and the operator is told), and a full room still takes the server', () => {
    const store = memoryStore();
    for (let i = 0; i < PASS_CLAIM_CAP; i++) {
      store.put({
        ticketId: ticket(i),
        atMs: NOW,
        gate: 'Gate A',
        passId: PASS_A,
        confirmed: false,
        seq: store.nextSeq(),
        removed: null,
      });
    }
    const { room: r } = room(store);
    expect(r.fromPhone(gateA, phoneIn(T1))).toMatchObject({
      broadcast: [],
      warn: expect.any(String),
    });
    expect(r.fromPhone(gateB, phoneIn(T1)).kind).toBe('ok'); // another pass still can

    for (let i = PASS_CLAIM_CAP; store.count() < ROOM_CAP; i++) {
      store.put({
        ticketId: ticket(i),
        atMs: NOW,
        gate: null,
        passId: null,
        confirmed: true,
        seq: store.nextSeq(),
        removed: null,
      });
    }
    expect(r.fromPhone(gateB, phoneIn(T2))).toEqual(nothing);
    expect(r.fromServer(serverIn(T2, NOW))).toMatchObject({
      kind: 'ok',
      broadcast: [{ t: 'checkins' }],
    });
  });
});
