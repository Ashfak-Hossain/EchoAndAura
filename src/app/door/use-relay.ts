'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { RELAY_PROTOCOL } from '@/server/lib/relay-protocol';
import type { RelayOwnMark, RelayRow } from './offline/rules';

/**
 * ADR-058: the door phone's live link to its event's room on the gate
 * relay. Every check-in any gate makes arrives here within a fraction of a
 * second — while our server is down too — and goes into the phone's marks
 * (offline/rules.ts decides how). The status ping keeps running: the link
 * only makes sharing faster, and nothing depends on it being up.
 */

export type RelayState = 'off' | 'connecting' | 'live';

const PING_EVERY_MS = 30_000;
/** No pong for this long: the socket is dead even if it still says OPEN (S3). */
const PONG_DEADLINE_MS = 2 * PING_EVERY_MS + 5_000;
const RETRY_MIN_MS = 1_000;
const RETRY_MAX_MS = 30_000;
/** The room closed us for good: the pass expired (4001) or was revoked (4003). */
const FINAL_CLOSE = new Set([4001, 4003]);
/** Too many phones on this pass (4008): wait long, or they evict each other in turn. */
const CROWDED_CLOSE = 4008;
const CROWDED_WAIT_MS = 60_000;
/** Claims re-sent on open go as batches: one message, one rate unit (B-1). */
const CLAIMS_PER_BATCH = 200;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** The room's messages are input: checked, never cast (N4). */
function relayRow(value: unknown): RelayRow | null {
  if (typeof value !== 'object' || value === null) return null;
  const r = value as Record<string, unknown>;
  if (typeof r.ticketId !== 'string' || !UUID.test(r.ticketId)) return null;
  if (typeof r.at !== 'string' || !Number.isFinite(Date.parse(r.at))) return null;
  if (r.gate !== null && typeof r.gate !== 'string') return null;
  if (typeof r.confirmed !== 'boolean') return null;
  if (typeof r.seq !== 'number' || !Number.isInteger(r.seq)) return null;
  return { ticketId: r.ticketId, at: r.at, gate: r.gate, confirmed: r.confirmed, seq: r.seq };
}

export function useRelay({
  ticket,
  onRows,
  onUndo,
  ownClaims,
}: {
  /** From the saved ticket list; null when the relay is off. */
  ticket: { url: string; pass: string } | null | undefined;
  onRows: (rows: RelayRow[]) => void;
  onUndo: (ticketId: string, undo: { by: 'gate' | 'server'; at: string }) => void;
  /** This phone's own admits and undos the server may not have yet. */
  ownClaims: () => RelayOwnMark[];
}): { state: RelayState; send: (mark: RelayOwnMark) => void } {
  const [state, setState] = useState<RelayState>('off');
  const socket = useRef<WebSocket | null>(null);
  /** The room's last seq heard: where a reconnect picks up (S2) … */
  const heard = useRef(0);
  /** … in that room: a rebuilt room has another epoch, and starts over (S-D). */
  const epoch = useRef('');
  // The latest of each, read when (re)connecting — a new list every 60 s
  // brings a freshly signed pass, which must not restart a working link.
  const latest = useRef({ ticket, onRows, onUndo, ownClaims });
  useEffect(() => {
    latest.current = { ticket, onRows, onUndo, ownClaims };
  }, [ticket, onRows, onUndo, ownClaims]);
  const url = ticket?.url ?? null;

  useEffect(() => {
    if (!url) return;
    let stopped = false;
    let retryMs = RETRY_MIN_MS;
    let retryTimer: ReturnType<typeof setTimeout> | undefined;
    let pingTimer: ReturnType<typeof setInterval> | undefined;

    const seen = (seq: number) => {
      if (seq > heard.current) heard.current = seq;
    };

    const connect = () => {
      const current = latest.current;
      if (stopped || !current.ticket) return;
      setState('connecting');
      let ws: WebSocket;
      try {
        ws = new WebSocket(`${current.ticket.url}?epoch=${epoch.current}&after=${heard.current}`, [
          RELAY_PROTOCOL,
          current.ticket.pass,
        ]);
      } catch {
        retry();
        return;
      }
      socket.current = ws;
      let lastPong = Date.now();

      ws.onopen = () => {
        retryMs = RETRY_MIN_MS;
        setState('live');
        // Anything sent into a dead socket before is sent again; the room
        // ignores what it already has.
        const claims = latest.current.ownClaims();
        for (let i = 0; i < claims.length; i += CLAIMS_PER_BATCH) {
          ws.send(JSON.stringify({ t: 'claims', items: claims.slice(i, i + CLAIMS_PER_BATCH) }));
        }
        clearInterval(pingTimer);
        lastPong = Date.now();
        pingTimer = setInterval(() => {
          if (Date.now() - lastPong > PONG_DEADLINE_MS) {
            ws.close(4000, 'no pong');
            return;
          }
          // Answered by the room without waking it.
          if (ws.readyState === WebSocket.OPEN) ws.send('ping');
        }, PING_EVERY_MS);
      };
      ws.onmessage = (e: MessageEvent) => {
        if (typeof e.data !== 'string') return;
        lastPong = Date.now();
        if (e.data === 'pong') return;
        let msg: unknown;
        try {
          msg = JSON.parse(e.data);
        } catch {
          return;
        }
        if (typeof msg !== 'object' || msg === null) return;
        const m = msg as Record<string, unknown>;
        if (m.t === 'hello' && typeof m.epoch === 'string') {
          // Another room than the cursor's: the catch-up that follows is complete.
          if (m.epoch !== epoch.current) heard.current = 0;
          epoch.current = m.epoch;
        } else if (m.t === 'checkins' && Array.isArray(m.rows)) {
          const rows = m.rows.map(relayRow).filter((r): r is RelayRow => r !== null);
          for (const r of rows) seen(r.seq);
          latest.current.onRows(rows);
        } else if (
          m.t === 'undo' &&
          typeof m.ticketId === 'string' &&
          UUID.test(m.ticketId) &&
          (m.by === 'gate' || m.by === 'server') &&
          typeof m.at === 'string'
        ) {
          if (typeof m.seq === 'number' && Number.isInteger(m.seq)) seen(m.seq);
          latest.current.onUndo(m.ticketId, { by: m.by, at: m.at });
        }
      };
      ws.onclose = (e: CloseEvent) => {
        clearInterval(pingTimer);
        if (socket.current === ws) socket.current = null;
        if (stopped) return;
        if (FINAL_CLOSE.has(e.code)) {
          // The server says why on the next ping (signed out / ended).
          setState('off');
          return;
        }
        if (e.code === CROWDED_CLOSE) retryMs = CROWDED_WAIT_MS;
        retry();
      };
    };

    function retry() {
      setState('connecting');
      // Jittered, so gates that lost the link together do not return together.
      const wait = retryMs * (0.75 + Math.random() * 0.5);
      retryMs = Math.min(Math.max(RETRY_MAX_MS, retryMs), retryMs * 2);
      clearTimeout(retryTimer);
      retryTimer = setTimeout(connect, wait);
    }

    // The phone got its signal back: try now, not at the end of a long wait.
    const onOnline = () => {
      if (socket.current) return;
      retryMs = RETRY_MIN_MS;
      clearTimeout(retryTimer);
      connect();
    };
    window.addEventListener('online', onOnline);
    connect();
    return () => {
      stopped = true;
      window.removeEventListener('online', onOnline);
      clearTimeout(retryTimer);
      clearInterval(pingTimer);
      socket.current?.close(1000, 'done');
      socket.current = null;
      setState('off');
    };
  }, [url]);

  /** Best effort: if the link is down, the next open re-sends it (ownClaims). */
  const send = useCallback((mark: RelayOwnMark) => {
    const ws = socket.current;
    if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(mark));
  }, []);

  return { state, send };
}
