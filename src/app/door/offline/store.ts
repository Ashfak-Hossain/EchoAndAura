import type { DoorVerdict, OfflineList } from '@/server/lib/door-offline';
import type { ScanMethod } from '@/server/services/door.service';

/**
 * ADR-034: what the door phone keeps for when the signal drops — the
 * event's ticket list and the outbox of scans answered offline. IndexedDB,
 * so both survive the tab being put to sleep; wiped when the session ends
 * or the pass stops working. Without IndexedDB (some private modes) it
 * falls back to memory: offline answers still work while the tab lives.
 */

export interface StoredList {
  list: OfflineList;
  /** Server clock minus this phone's clock (ms), measured on download. */
  offsetMs: number;
}

/** One scan answered offline, waiting to be sent. */
export interface OutboxItem {
  scanId: string;
  passId: string;
  method: Extract<ScanMethod, 'qr' | 'typed'>;
  input: string;
  /** The phone's clock corrected by the offset (ISO). */
  scannedAt: string;
  verdict: DoorVerdict;
  /** The online request this scan replaced, when that one got no answer. */
  supersedesScanId?: string;
  /**
   * Sent at least once, answered or not (ADR-034). It may already stand on
   * the server, so the phone never undoes it locally any more.
   */
  attempted?: boolean;
  /** For this phone's own screen: whom it was, and its "already in" mark. */
  ticketId?: string;
  attendeeName?: string;
  ticketTypeName?: string;
}

export interface OfflineStore {
  loadList(): Promise<StoredList | null>;
  saveList(value: StoredList): Promise<void>;
  loadOutbox(): Promise<OutboxItem[]>;
  putOutbox(item: OutboxItem): Promise<void>;
  removeOutbox(scanIds: string[]): Promise<void>;
  /** Everything: the list and the outbox. */
  clear(): Promise<void>;
}

const DB_NAME = 'door-offline';
const DB_VERSION = 1;
const META = 'meta';
const OUTBOX = 'outbox';
const LIST_KEY = 'list';

function request<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error('IndexedDB request failed'));
  });
}

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(META)) db.createObjectStore(META);
      if (!db.objectStoreNames.contains(OUTBOX))
        db.createObjectStore(OUTBOX, { keyPath: 'scanId' });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error('IndexedDB open failed'));
    req.onblocked = () => reject(new Error('IndexedDB blocked'));
  });
}

function done(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error('IndexedDB transaction failed'));
    tx.onabort = () => reject(tx.error ?? new Error('IndexedDB transaction aborted'));
  });
}

function indexedDbStore(dbp: Promise<IDBDatabase>): OfflineStore {
  return {
    async loadList() {
      const db = await dbp;
      const value: unknown = await request(db.transaction(META).objectStore(META).get(LIST_KEY));
      return (value as StoredList | undefined) ?? null;
    },
    async saveList(value) {
      const db = await dbp;
      const tx = db.transaction(META, 'readwrite');
      tx.objectStore(META).put(value, LIST_KEY);
      await done(tx);
    },
    async loadOutbox() {
      const db = await dbp;
      const rows = await request(db.transaction(OUTBOX).objectStore(OUTBOX).getAll());
      // Oldest first: the order the gate scanned them.
      return (rows as OutboxItem[]).sort((a, b) => a.scannedAt.localeCompare(b.scannedAt));
    },
    async putOutbox(item) {
      const db = await dbp;
      const tx = db.transaction(OUTBOX, 'readwrite');
      tx.objectStore(OUTBOX).put(item);
      await done(tx);
    },
    async removeOutbox(scanIds) {
      const db = await dbp;
      const tx = db.transaction(OUTBOX, 'readwrite');
      const store = tx.objectStore(OUTBOX);
      for (const id of scanIds) store.delete(id);
      await done(tx);
    },
    async clear() {
      const db = await dbp;
      const tx = db.transaction([META, OUTBOX], 'readwrite');
      tx.objectStore(META).clear();
      tx.objectStore(OUTBOX).clear();
      await done(tx);
    },
  };
}

export function memoryStore(): OfflineStore {
  let list: StoredList | null = null;
  const outbox = new Map<string, OutboxItem>();
  return {
    loadList: async () => list,
    saveList: async (value) => {
      list = value;
    },
    loadOutbox: async () =>
      [...outbox.values()].sort((a, b) => a.scannedAt.localeCompare(b.scannedAt)),
    putOutbox: async (item) => {
      outbox.set(item.scanId, item);
    },
    removeOutbox: async (ids) => {
      for (const id of ids) outbox.delete(id);
    },
    clear: async () => {
      list = null;
      outbox.clear();
    },
  };
}

/**
 * IndexedDB when it opens; otherwise memory. Every call falls back too: a
 * store that fails mid-evening must never stop the gate answering.
 */
export function openOfflineStore(): OfflineStore {
  const memory = memoryStore();
  if (typeof indexedDB === 'undefined') return memory;
  const dbp = open();
  // Unhandled otherwise when every method falls back before awaiting it.
  dbp.catch(() => undefined);
  const idb = indexedDbStore(dbp);
  const safe =
    <A extends unknown[], R>(primary: (...a: A) => Promise<R>, fallback: (...a: A) => Promise<R>) =>
    async (...a: A): Promise<R> => {
      try {
        return await primary(...a);
      } catch {
        return fallback(...a);
      }
    };
  return {
    loadList: safe(idb.loadList, memory.loadList),
    saveList: async (value) => {
      await memory.saveList(value);
      await idb.saveList(value).catch(() => undefined);
    },
    loadOutbox: safe(idb.loadOutbox, memory.loadOutbox),
    putOutbox: async (item) => {
      await memory.putOutbox(item);
      await idb.putOutbox(item).catch(() => undefined);
    },
    removeOutbox: async (ids) => {
      await memory.removeOutbox(ids);
      await idb.removeOutbox(ids).catch(() => undefined);
    },
    clear: async () => {
      await memory.clear();
      await idb.clear().catch(() => undefined);
    },
  };
}
