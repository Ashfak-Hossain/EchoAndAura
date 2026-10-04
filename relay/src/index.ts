import { DurableObject } from 'cloudflare:workers';
import { RELAY_PROTOCOL } from '../../src/server/lib/relay-protocol';
import { verifyRelayPass } from '../../src/server/lib/relay-pass';
import { type RoomAction, type RoomStore, type StoredCheckIn, createRoom } from './room';

/**
 * ADR-058: the gate relay. A Worker in front checks every pass with the
 * shared secret (never asking our server), and one Durable Object per
 * event holds that event's room: the door phones' WebSockets and the
 * check-ins heard so far, in its own SQLite.
 *
 *   GET  /events/<eventId>/ws?epoch=<e>&after=<seq>
 *                                          a door phone joins (WebSocket;
 *                                          the pass in the subprotocol)
 *   POST /events/<eventId>/announce        our server's worker, after a commit
 *   GET  /health                           "ok"
 */

export interface Env {
  ROOMS: DurableObjectNamespace<EventRoom>;
  RELAY_SECRET: string;
  /** Comma-separated origins a door page may connect from. */
  ALLOWED_ORIGINS: string;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const ROUTE = /^\/events\/([0-9a-f-]{36})\/(ws|announce)$/;
/** Messages per PASS per 10 s (all its sockets together); a gate scans far slower. */
const RATE_PER_WINDOW = 50;
const RATE_WINDOW_MS = 10_000;
/** Phones on one pass: a few may share a gate code; past this the oldest goes. */
const SOCKETS_PER_PASS = 4;
/**
 * Bump when the room's tables change: an older room's check-ins are rebuilt
 * empty (they are relay copies — Postgres is the truth, phones re-send
 * their claims). Revocations are never dropped: they are security state.
 */
const SCHEMA_VERSION = 3;
/** A room's data outlives its last pass, announcement or revoked pass by a day, then goes. */
const KEEP_AFTER_MS = 24 * 3_600_000;

function text(status: number, body: string): Response {
  return new Response(body, { status, headers: { 'Content-Type': 'text/plain' } });
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname === '/health') return text(200, 'ok');
    const match = ROUTE.exec(url.pathname);
    const eventId = match?.[1];
    if (!match || !eventId || !UUID.test(eventId)) return text(404, 'not found');
    const now = Date.now();
    const room = env.ROOMS.get(env.ROOMS.idFromName(eventId), { locationHint: 'apac' });

    if (match[2] === 'announce') {
      if (request.method !== 'POST') return text(405, 'method not allowed');
      const token = request.headers.get('Authorization')?.replace(/^Bearer /, '') ?? '';
      const claims = await verifyRelayPass(token, env.RELAY_SECRET, now);
      if (!claims || claims.role !== 'server' || claims.eventId !== eventId) {
        return text(401, 'unauthorized');
      }
      return room.fetch(
        new Request('https://room/announce', { method: 'POST', body: request.body }),
      );
    }

    if (request.headers.get('Upgrade')?.toLowerCase() !== 'websocket') {
      return text(426, 'websocket expected');
    }
    const allowed = env.ALLOWED_ORIGINS.split(',').map((o) => o.trim());
    if (!allowed.includes(request.headers.get('Origin') ?? '')) return text(403, 'origin');
    // "ea-relay.v1, <pass>": our protocol name, then the pass.
    const offered = (request.headers.get('Sec-WebSocket-Protocol') ?? '')
      .split(',')
      .map((p) => p.trim());
    const token = offered[0] === RELAY_PROTOCOL ? (offered[1] ?? '') : '';
    const claims = await verifyRelayPass(token, env.RELAY_SECRET, now);
    if (!claims || claims.role !== 'gate' || claims.eventId !== eventId) {
      return text(401, 'unauthorized');
    }
    const after = Number(url.searchParams.get('after'));
    const epoch = url.searchParams.get('epoch') ?? '';
    const headers = new Headers({
      Upgrade: 'websocket',
      'X-Pass-Id': claims.passId ?? '',
      'X-Gate': encodeURIComponent(claims.gate ?? ''),
      'X-Exp': String(claims.exp),
      'X-After': Number.isInteger(after) && after > 0 ? String(after) : '0',
      'X-Epoch': /^[0-9a-f-]{36}$/.test(epoch) ? epoch : '',
    });
    return room.fetch(new Request('https://room/ws', { headers }));
  },
} satisfies ExportedHandler<Env>;

interface Attachment {
  passId: string;
  gate: string;
  /** Pass expiry, unix seconds. */
  exp: number;
}

export class EventRoom extends DurableObject<Env> {
  private readonly room;
  /**
   * Per pass, in memory only (reset if the room sleeps — harmless). By pass,
   * not socket: reconnecting must not buy a fresh budget.
   */
  private readonly rate = new Map<string, { start: number; n: number }>();

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    const sql = ctx.storage.sql;
    this.ensureSchema();
    const row = (r: Record<string, SqlStorageValue>): StoredCheckIn => ({
      ticketId: String(r.ticket_id),
      atMs: Number(r.at_ms),
      gate: r.gate === null ? null : String(r.gate),
      passId: r.pass_id === null ? null : String(r.pass_id),
      confirmed: Number(r.confirmed) === 1,
      seq: Number(r.seq),
      removed: r.removed === 'gate' || r.removed === 'server' ? r.removed : null,
    });
    const meta = (k: string) => {
      const [r] = sql.exec('SELECT v FROM meta WHERE k = ?', k).toArray();
      return r ? r.v : null;
    };
    const topSeq = () => Number(meta('seq') ?? 0);
    const store: RoomStore = {
      get: (id) => {
        const [r] = sql.exec('SELECT * FROM checkins WHERE ticket_id = ?', id).toArray();
        return r ? row(r) : null;
      },
      put: (r) => {
        sql.exec(
          `INSERT OR REPLACE INTO checkins (ticket_id, at_ms, gate, pass_id, confirmed, seq, removed)
           VALUES (?, ?, ?, ?, ?, ?, ?)`,
          r.ticketId,
          r.atMs,
          r.gate,
          r.passId,
          r.confirmed ? 1 : 0,
          r.seq,
          r.removed,
        );
      },
      after: (seq, limit) =>
        sql
          .exec('SELECT * FROM checkins WHERE seq > ? ORDER BY seq LIMIT ?', seq, limit)
          .toArray()
          .map(row),
      claimsOf: (passId) =>
        sql
          .exec(
            'SELECT * FROM checkins WHERE pass_id = ? AND confirmed = 0 AND removed IS NULL',
            passId,
          )
          .toArray()
          .map(row),
      rowsOf: (passId) =>
        Number(sql.exec('SELECT count(*) AS n FROM checkins WHERE pass_id = ?', passId).one().n),
      count: () => Number(sql.exec('SELECT count(*) AS n FROM checkins').one().n),
      nextSeq: () => {
        const next = topSeq() + 1;
        sql.exec("INSERT OR REPLACE INTO meta (k, v) VALUES ('seq', ?)", next);
        return next;
      },
      topSeq,
      epoch: () => String(meta('epoch')),
      isRevoked: (id) =>
        sql.exec('SELECT 1 FROM revoked WHERE pass_id = ?', id).toArray().length > 0,
      revoke: (id) => {
        sql.exec('INSERT OR IGNORE INTO revoked (pass_id) VALUES (?)', id);
      },
    };
    this.room = createRoom(store);
    // A phone's keepalive is answered without waking the room.
    ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair('ping', 'pong'));
  }

  /**
   * The tables, created if missing (a new room, or one just emptied by the
   * alarm). An older schema's check-ins are rebuilt; revocations stay. A
   * (re)built room gets a new epoch, so no phone's cursor carries over.
   */
  private ensureSchema(): void {
    const sql = this.ctx.storage.sql;
    sql.exec('CREATE TABLE IF NOT EXISTS meta (k TEXT PRIMARY KEY, v TEXT NOT NULL)');
    sql.exec('CREATE TABLE IF NOT EXISTS revoked (pass_id TEXT PRIMARY KEY)');
    const [version] = sql.exec("SELECT v FROM meta WHERE k = 'schema'").toArray();
    if (Number(version?.v ?? 0) !== SCHEMA_VERSION) {
      sql.exec('DROP TABLE IF EXISTS checkins');
      sql.exec("DELETE FROM meta WHERE k IN ('seq', 'epoch')");
      sql.exec("INSERT OR REPLACE INTO meta (k, v) VALUES ('schema', ?)", String(SCHEMA_VERSION));
    }
    sql.exec(`CREATE TABLE IF NOT EXISTS checkins (
      ticket_id TEXT PRIMARY KEY,
      at_ms INTEGER NOT NULL,
      gate TEXT,
      pass_id TEXT,
      confirmed INTEGER NOT NULL,
      seq INTEGER NOT NULL,
      removed TEXT)`);
    sql.exec('CREATE INDEX IF NOT EXISTS checkins_seq ON checkins (seq)');
    sql.exec('CREATE INDEX IF NOT EXISTS checkins_pass ON checkins (pass_id, confirmed)');
    sql.exec("INSERT OR IGNORE INTO meta (k, v) VALUES ('epoch', ?)", crypto.randomUUID());
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname === '/announce') return this.announce(request);

    const passId = request.headers.get('X-Pass-Id') ?? '';
    const gate = decodeURIComponent(request.headers.get('X-Gate') ?? '');
    const exp = Number(request.headers.get('X-Exp'));
    if (!passId || !gate || !Number.isFinite(exp)) return text(400, 'bad request');
    if (this.room.isRevoked(passId)) return text(401, 'revoked');

    // Too many phones on one pass: the oldest connection makes room.
    const same = this.ctx.getWebSockets(passId);
    for (const old of same.slice(0, Math.max(0, same.length - SOCKETS_PER_PASS + 1))) {
      old.close(4008, 'too many connections for this pass');
    }

    const pair = new WebSocketPair();
    const [client, server] = [pair[0], pair[1]];
    // Tagged with the pass id, so a revoke finds its sockets.
    this.ctx.acceptWebSocket(server, [passId]);
    server.serializeAttachment({ passId, gate, exp } satisfies Attachment);
    const after = Number(request.headers.get('X-After')) || 0;
    const epoch = request.headers.get('X-Epoch') || null;
    for (const message of this.room.backlog(after, epoch)) server.send(JSON.stringify(message));
    await this.keepUntil(exp * 1000 + KEEP_AFTER_MS);
    return new Response(null, {
      status: 101,
      webSocket: client,
      headers: { 'Sec-WebSocket-Protocol': RELAY_PROTOCOL },
    });
  }

  async webSocketMessage(ws: WebSocket, message: string | ArrayBuffer): Promise<void> {
    const who = ws.deserializeAttachment() as Attachment | null;
    if (!who || who.exp * 1000 <= Date.now()) {
      ws.close(4001, 'pass expired');
      return;
    }
    if (typeof message !== 'string' || !this.withinRate(who.passId)) {
      ws.close(1008, 'not allowed');
      return;
    }
    await this.apply(this.room.fromPhone({ passId: who.passId, gate: who.gate }, message), ws);
  }

  /** The room's data is kept a day past its last pass, announcement or revoke, then deleted. */
  async alarm(): Promise<void> {
    const nowMs = Date.now();
    let live = 0;
    for (const ws of this.ctx.getWebSockets()) {
      const who = ws.deserializeAttachment() as Attachment | null;
      // Pings are answered without waking us, so an expired pass can linger.
      if (!who || who.exp * 1000 <= nowMs) ws.close(4001, 'pass expired');
      else live++;
    }
    if (live > 0) {
      await this.ctx.storage.setAlarm(nowMs + KEEP_AFTER_MS);
      return;
    }
    await this.ctx.storage.deleteAll();
    // Ready again at once, should anything arrive before this instance goes.
    this.ensureSchema();
  }

  private async announce(request: Request): Promise<Response> {
    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return text(400, 'bad request');
    }
    const action = this.room.fromServer(body);
    if (!action) return text(400, 'bad request');
    await this.apply(action, null);
    await this.keepUntil(Date.now() + KEEP_AFTER_MS);
    return new Response(null, { status: 204 });
  }

  private async apply(action: RoomAction, sender: WebSocket | null): Promise<void> {
    if (action.kind === 'reject') {
      sender?.close(1008, action.reason);
      return;
    }
    if (action.warn) console.warn(`relay: ${action.warn}`);
    const nowMs = Date.now();
    for (const message of action.broadcast) {
      const data = JSON.stringify(message);
      for (const ws of this.ctx.getWebSockets()) {
        // Only the sending socket: other phones on the same pass must hear it.
        if (action.skipSender && ws === sender) continue;
        const who = ws.deserializeAttachment() as Attachment | null;
        if (!who) continue;
        if (who.exp * 1000 <= nowMs) {
          ws.close(4001, 'pass expired');
          continue;
        }
        try {
          ws.send(data);
        } catch {
          // A socket closing as we send: its next connect's catch-up covers it.
        }
      }
    }
    if (action.closePass) {
      for (const ws of this.ctx.getWebSockets(action.closePass)) ws.close(4003, 'pass revoked');
    }
    if (action.keepUntil) await this.keepUntil(action.keepUntil + KEEP_AFTER_MS);
  }

  private withinRate(passId: string): boolean {
    const nowMs = Date.now();
    const r = this.rate.get(passId);
    if (!r || nowMs - r.start > RATE_WINDOW_MS) {
      this.rate.set(passId, { start: nowMs, n: 1 });
      return true;
    }
    r.n += 1;
    return r.n <= RATE_PER_WINDOW;
  }

  private async keepUntil(atMs: number): Promise<void> {
    const current = await this.ctx.storage.getAlarm();
    if (current === null || current < atMs) await this.ctx.storage.setAlarm(atMs);
  }
}
