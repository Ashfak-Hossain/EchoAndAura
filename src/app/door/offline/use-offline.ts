'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  type LocalAdmit,
  OFFLINE_LIST_VERSION,
  type OfflineEntry,
  judgeOffline,
  offlineDigest,
} from '@/server/lib/door-offline';
import { DOOR_UNDO_WINDOW_MS, SCAN_INPUT_MAX } from '@/server/lib/door-rules';
import { parseScanToken } from '@/server/lib/scan-token';
import { type SyncScan, type WireScanResult, type WireSearchResult, doorApi } from '../door-api';
import { type OfflineStore, type OutboxItem, type StoredList, openOfflineStore } from './store';

/**
 * ADR-034: the gate keeps working without signal. While online the phone
 * keeps a fresh copy of the event's ticket list (hashed codes, names); when
 * a scan gets no answer it judges the scan from that list, shows the
 * answer marked "offline", and puts the scan in an outbox that is sent as
 * soon as the server answers again. The server re-judges every one and
 * records what the door showed; an offline ADMIT it cannot honour is a
 * double entry the organizer sees.
 */

const LIST_EVERY_MS = 60_000;
const SYNC_EVERY_MS = 10_000;
/** Per request; the route accepts at most this many (OFFLINE_SYNC_BATCH). */
const SYNC_BATCH = 50;
const SEARCH_LIMIT = 10;

interface Mark {
  /** Corrected clock, ms. */
  at: number;
  gate: string;
  byThisPhone: boolean;
}

export type OfflineUndo = 'done' | 'sending' | 'not_found';

export interface OfflineApi {
  /** A list is here and usable: offline answers are possible. */
  ready: boolean;
  /** When the list was built (server clock, ISO), and how many tickets. */
  listAt: string | null;
  size: number;
  /** Scans answered offline, not yet sent — oldest first. */
  pending: OutboxItem[];
  syncing: boolean;
  /** Something the gate should know (a refused sync). */
  problem: string | null;
  /** This phone's clock corrected to the server's (ms). */
  now(): number;
  /** Judge one read offline and queue it; null when there is no usable list. */
  answer(
    raw: string,
    method: 'qr' | 'typed',
    supersedesScanId?: string,
  ): Promise<WireScanResult | null>;
  /** An online answer: remember a check-in the list does not know of yet. */
  learn(read: { raw?: string; ticketId?: string }, result: WireScanResult): Promise<void>;
  /** The server's clock from a status ping, to keep the offset fresh. */
  learnServerTime(serverTime: string, sentAt: number, receivedAt: number): void;
  undo(scanId: string): Promise<OfflineUndo>;
  search(term: string): Promise<WireSearchResult[] | null>;
  /** Send the outbox now. True when the server answered. */
  sync(): Promise<boolean>;
  refreshList(): Promise<void>;
  /** Wipe everything (the session is over). Returns how many scans were never sent. */
  clear(): Promise<number>;
}

/** What goes to the server and the outbox: the code, never stray QR text. */
function loggableInput(raw: string): string {
  const trimmed = raw.trim().slice(0, SCAN_INPUT_MAX);
  // The server logs an unparsed read as its length only; keep just that.
  return parseScanToken(trimmed) ?? '#'.repeat(Math.max(1, trimmed.length));
}

export function useOffline({
  passId,
  gate,
  onSignedOut,
}: {
  passId: string;
  gate: string;
  onSignedOut: (message: string) => void;
}): OfflineApi {
  const store = useRef<OfflineStore | null>(null);
  const list = useRef<StoredList | null>(null);
  const index = useRef(new Map<string, OfflineEntry>());
  const marks = useRef(new Map<string, Mark>());
  const outbox = useRef<OutboxItem[]>([]);
  const inFlight = useRef(new Set<string>());
  const syncingRef = useRef(false);
  const listing = useRef(false);

  /** What the screen shows — refreshed from the refs whenever they change. */
  const [snap, setSnap] = useState<{
    listAt: string | null;
    size: number;
    pending: OutboxItem[];
  }>({ listAt: null, size: 0, pending: [] });
  const bump = useCallback(
    () =>
      setSnap({
        listAt: list.current?.list.serverTime ?? null,
        size: list.current?.list.entries.length ?? 0,
        pending: outbox.current,
      }),
    [],
  );
  const [syncing, setSyncing] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  const now = useCallback(() => Date.now() + (list.current?.offsetMs ?? 0), []);

  /** Rebuild the index; keep only the marks the new list cannot know of. */
  const adopt = useCallback(
    (stored: StoredList) => {
      list.current = stored;
      index.current = new Map(stored.list.entries.map((e) => [e.d, e]));
      const since = Date.parse(stored.list.serverTime);
      for (const [id, m] of marks.current) if (m.at <= since) marks.current.delete(id);
      for (const item of outbox.current) {
        if (item.verdict === 'admitted' && item.ticketId) {
          marks.current.set(item.ticketId, {
            at: Date.parse(item.scannedAt),
            gate,
            byThisPhone: true,
          });
        }
      }
      bump();
    },
    [bump, gate],
  );

  const refreshList = useCallback(async () => {
    if (listing.current || !store.current) return;
    listing.current = true;
    try {
      const sentAt = Date.now();
      const reply = await doorApi.list();
      const receivedAt = Date.now();
      if (reply.ok) {
        const offsetMs = Date.parse(reply.data.serverTime) - (sentAt + receivedAt) / 2;
        const stored = { list: reply.data, offsetMs };
        adopt(stored);
        await store.current?.saveList(stored);
      } else if (reply.kind === 'signed_out') {
        onSignedOut(reply.message);
      }
    } finally {
      listing.current = false;
    }
  }, [adopt, onSignedOut]);

  const sync = useCallback(async (): Promise<boolean> => {
    if (syncingRef.current || !store.current) return false;
    if (outbox.current.length === 0) return true;
    syncingRef.current = true;
    setSyncing(true);
    try {
      while (outbox.current.length > 0) {
        const batch = outbox.current.slice(0, SYNC_BATCH);
        for (const item of batch) inFlight.current.add(item.scanId);
        const reply = await doorApi.sync(
          batch.map((item): SyncScan => ({
            scanId: item.scanId,
            method: item.method,
            input: item.input,
            scannedAt: item.scannedAt,
            offline: {
              verdict: item.verdict,
              ...(item.supersedesScanId ? { supersedesScanId: item.supersedesScanId } : {}),
            },
          })),
        );
        for (const item of batch) inFlight.current.delete(item.scanId);
        if (reply.ok || reply.kind === 'refused') {
          const ids = batch.map((i) => i.scanId);
          if (!reply.ok) {
            // Never expected (the phone builds valid scans); a batch the
            // server refuses would otherwise block the outbox all night.
            setProblem(
              `${ids.length} offline ${ids.length === 1 ? 'scan was' : 'scans were'} refused by the server — tell the organizer.`,
            );
          }
          outbox.current = outbox.current.filter((i) => !ids.includes(i.scanId));
          await store.current.removeOutbox(ids);
          bump();
          if (!reply.ok) return true;
          continue;
        }
        if (reply.kind === 'signed_out') onSignedOut(reply.message);
        return false;
      }
      return true;
    } finally {
      syncingRef.current = false;
      setSyncing(false);
    }
  }, [bump, onSignedOut]);

  // Load what this phone kept, then fetch a fresh list.
  useEffect(() => {
    const s = openOfflineStore();
    store.current = s;
    let live = true;
    void (async () => {
      const [kept, queued] = await Promise.all([s.loadList(), s.loadOutbox()]);
      if (!live) return;
      // Another pass's scans cannot be sent under this one: its gate label
      // would be wrong in the record. (The phone was re-used for a gate.)
      const mine = queued.filter((i) => i.passId === passId);
      const theirs = queued.filter((i) => i.passId !== passId);
      if (theirs.length > 0) {
        await s.removeOutbox(theirs.map((i) => i.scanId));
        setProblem(
          `${theirs.length} offline ${theirs.length === 1 ? 'scan' : 'scans'} from an earlier gate pass on this phone could not be sent.`,
        );
      }
      outbox.current = mine;
      const usable =
        kept &&
        kept.list.v === OFFLINE_LIST_VERSION &&
        kept.list.passId === passId &&
        Date.parse(kept.list.validUntil) > Date.now() + kept.offsetMs;
      if (usable) adopt(kept);
      else bump();
      void refreshList();
      void sync();
    })();
    return () => {
      live = false;
    };
  }, [passId, adopt, bump, refreshList, sync]);

  useEffect(() => {
    const listTimer = setInterval(() => void refreshList(), LIST_EVERY_MS);
    const syncTimer = setInterval(() => {
      if (outbox.current.length > 0) void sync();
    }, SYNC_EVERY_MS);
    return () => {
      clearInterval(listTimer);
      clearInterval(syncTimer);
    };
  }, [refreshList, sync]);

  const findEntry = useCallback(async (raw: string): Promise<OfflineEntry | null> => {
    const current = list.current;
    const code = parseScanToken(raw);
    if (!current || !code) return null;
    return index.current.get(await offlineDigest(current.list.salt, code)) ?? null;
  }, []);

  const answer = useCallback(
    async (
      raw: string,
      method: 'qr' | 'typed',
      supersedesScanId?: string,
    ): Promise<WireScanResult | null> => {
      const current = list.current;
      if (!current || !store.current) return null;
      const at = now();
      // Past the pass's window the server would refuse the sync anyway.
      if (at > Date.parse(current.list.validUntil)) return null;
      const entry = await findEntry(raw);
      const mark = entry ? marks.current.get(entry.id) : undefined;
      const localAdmit: LocalAdmit | null = mark
        ? { at: new Date(mark.at).toISOString(), gate: mark.gate, byThisPhone: mark.byThisPhone }
        : null;
      const j = judgeOffline({
        entry,
        localAdmit,
        now: at,
        validFrom: Date.parse(current.list.validFrom),
      });
      const scanId = crypto.randomUUID();
      const scannedAt = new Date(at).toISOString();
      const item: OutboxItem = {
        scanId,
        passId,
        method,
        input: loggableInput(raw),
        scannedAt,
        verdict: j.verdict,
        ...(supersedesScanId ? { supersedesScanId } : {}),
        ...(entry
          ? { ticketId: entry.id, attendeeName: entry.name, ticketTypeName: entry.type }
          : {}),
      };
      if (j.verdict === 'admitted' && entry) {
        marks.current.set(entry.id, { at, gate, byThisPhone: true });
      }
      outbox.current = [...outbox.current, item];
      await store.current.putOutbox(item);
      bump();
      const admitted = j.result === 'admitted';
      return {
        scanId,
        result: j.result,
        practice: j.practice,
        attendeeName: entry?.name,
        ticketTypeName: entry?.type,
        position: entry?.pos,
        total: entry?.of,
        at: j.at ?? (admitted ? scannedAt : undefined),
        gate: j.gate ?? (admitted ? gate : undefined),
        byThisPass: j.byThisPhone,
        secondsAgo: j.at ? Math.max(0, Math.floor((at - Date.parse(j.at)) / 1000)) : undefined,
      };
    },
    [bump, findEntry, gate, now, passId],
  );

  const learn = useCallback(
    async (read: { raw?: string; ticketId?: string }, result: WireScanResult) => {
      if (!list.current) return;
      if (result.result !== 'admitted' && result.result !== 'already_in') return;
      const id = read.ticketId ?? (read.raw ? (await findEntry(read.raw))?.id : undefined);
      if (!id || marks.current.has(id)) return;
      marks.current.set(id, {
        at: result.at ? Date.parse(result.at) : now(),
        gate: result.gate ?? gate,
        byThisPhone: result.result === 'admitted' || result.byThisPass === true,
      });
    },
    [findEntry, gate, now],
  );

  const learnServerTime = useCallback((serverTime: string, sentAt: number, receivedAt: number) => {
    const current = list.current;
    const t = Date.parse(serverTime);
    if (!current || Number.isNaN(t)) return;
    current.offsetMs = t - (sentAt + receivedAt) / 2;
  }, []);

  const undo = useCallback(
    async (scanId: string): Promise<OfflineUndo> => {
      const item = outbox.current.find((i) => i.scanId === scanId);
      if (!item || item.verdict !== 'admitted' || !store.current) return 'not_found';
      // Already on its way as an ADMIT: once it lands, the online undo applies.
      if (inFlight.current.has(scanId)) return 'sending';
      if (now() - Date.parse(item.scannedAt) > DOOR_UNDO_WINDOW_MS) return 'not_found';
      const undone: OutboxItem = { ...item, verdict: 'undone' };
      outbox.current = outbox.current.map((i) => (i.scanId === scanId ? undone : i));
      if (item.ticketId) marks.current.delete(item.ticketId);
      await store.current.putOutbox(undone);
      bump();
      return 'done';
    },
    [bump, now],
  );

  const search = useCallback(
    async (term: string): Promise<WireSearchResult[] | null> => {
      const current = list.current;
      if (!current) return null;
      const t = term.trim().toLowerCase();
      if (t.length < 2) return [];
      const byCode = await findEntry(term);
      const hits = current.list.entries.filter(
        (e) => e.name.toLowerCase().includes(t) || e.id === byCode?.id,
      );
      return hits
        .sort((a, b) => a.name.localeCompare(b.name) || a.pos - b.pos)
        .slice(0, SEARCH_LIMIT)
        .map((e) => {
          const mark = marks.current.get(e.id);
          return {
            ticketId: e.id,
            attendeeName: e.name,
            ticketTypeName: e.type,
            status: e.status,
            checkedInAt: mark ? new Date(mark.at).toISOString() : e.inAt,
            checkedInBy: mark ? mark.gate : e.inBy,
            // Unknown offline — and a name admit needs signal anyway.
            phoneOnFile: false,
          };
        });
    },
    [findEntry],
  );

  const clear = useCallback(async () => {
    const unsent = outbox.current.length;
    outbox.current = [];
    list.current = null;
    index.current = new Map();
    marks.current = new Map();
    await store.current?.clear();
    bump();
    return unsent;
  }, [bump]);

  return {
    ready: snap.listAt !== null,
    listAt: snap.listAt,
    size: snap.size,
    pending: snap.pending,
    syncing,
    problem,
    now,
    answer,
    learn,
    learnServerTime,
    undo,
    search,
    sync,
    refreshList,
    clear,
  };
}
