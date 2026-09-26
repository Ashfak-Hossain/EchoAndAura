import type { DbExecutor } from '@/db/executor';
import { DoorPassCodeCollisionError, DoorScanIdTakenError } from '@/server/lib/errors';
import type {
  DoorPassRecord,
  DoorRepository,
  DoorScanRecord,
  DoorTicket,
} from '@/server/repositories/door.repository';
import type { EventRecord } from '@/server/repositories/events.repository';
import type { TicketRecord } from '@/server/repositories/tickets.repository';
import type { fakeDb } from './fake-db';

type FakeDb = ReturnType<typeof fakeDb>;

/**
 * In-memory door repository over a `fakeDb` (its tickets, orders and
 * types), for the door service tests. Honours the contracts: UNIQUE pass
 * code and scan id, conditional revoke. It also enforces the pool rule —
 * inside a scan transaction, a statement without the transaction throws —
 * and rolls its own rows back with the transaction.
 */
export function fakeDoor(db: FakeDb, events: () => EventRecord[], clock: () => Date) {
  let passes: DoorPassRecord[] = [];
  let scans: DoorScanRecord[] = [];
  let inTx = false;
  let n = 0;

  function poolRule(tx: DbExecutor | undefined, what: string): void {
    if (inTx && tx === undefined) throw new Error(`${what}: pool statement inside a transaction`);
  }

  function view(t: TicketRecord): DoorTicket {
    const order = db.state.orders.find((o) => o.id === t.orderId);
    return {
      id: t.id,
      code: t.code,
      status: t.status,
      attendeeName: t.attendeeName,
      position: t.position,
      orderId: t.orderId,
      eventId: t.eventId,
      eventTitle: events().find((e) => e.id === t.eventId)?.title ?? '',
      ticketTypeName: db.state.types.get(t.ticketTypeId)?.name ?? '',
      orderQuantity: order?.quantity ?? 0,
      checkedInAt: t.checkedInAt,
      checkedInBy: t.checkedInBy,
      checkedInScanId: t.checkedInScanId,
      checkedInPassId: scans.find((s) => s.scanId === t.checkedInScanId)?.passId ?? null,
      buyerPhoneLast3: order?.buyerPhone ? order.buyerPhone.slice(-3) : null,
    };
  }

  const door: DoorRepository = {
    async insertPass(values) {
      if (passes.some((p) => p.code === values.code)) throw new DoorPassCodeCollisionError();
      const row: DoorPassRecord = {
        id: `00000000-0000-4000-8000-${String(++n).padStart(12, '0')}`,
        createdAt: clock(),
        revokedAt: null,
        ...values,
      };
      passes.push(row);
      return { ...row };
    },
    async findPassByCode(code) {
      const row = passes.find((p) => p.code === code);
      return row ? { ...row } : null;
    },
    async findPassById(id) {
      const row = passes.find((p) => p.id === id);
      return row ? { ...row } : null;
    },
    async revokePass(id, tx) {
      poolRule(tx, 'revokePass');
      const row = passes.find((p) => p.id === id && p.revokedAt === null);
      if (!row) return null;
      row.revokedAt = clock();
      return { ...row };
    },
    async lockActivePass(id, tx) {
      poolRule(tx, 'lockActivePass');
      return passes.some((p) => p.id === id && p.revokedAt === null);
    },
    async listPasses(eventId) {
      return passes
        .filter((p) => p.eventId === eventId)
        .map((pass) => {
          const own = scans.filter((s) => s.passId === pass.id);
          const admits = own.filter((s) => s.result === 'admitted');
          return {
            pass: { ...pass },
            scans: own.length,
            offlineScans: own.filter((s) => s.mode === 'offline').length,
            admitted: admits.length,
            searchAdmits: admits.filter((s) => s.method === 'search').length,
            lastScanAt: own.at(-1)?.receivedAt ?? null,
          };
        });
    },
    async insertScan(values, tx) {
      poolRule(tx, 'insertScan');
      if (scans.some((s) => s.scanId === values.scanId)) {
        throw new DoorScanIdTakenError(values.scanId);
      }
      const row: DoorScanRecord = {
        id: `scan-row-${++n}`,
        ticketId: null,
        priorCheckedInAt: null,
        priorCheckedInBy: null,
        scannedAt: null,
        doorVerdict: null,
        supersedesScanId: null,
        receivedAt: clock(),
        ...values,
      };
      scans.push(row);
      return { ...row };
    },
    async findScanByScanId(scanId) {
      poolRule(undefined, 'findScanByScanId');
      const row = scans.find((s) => s.scanId === scanId);
      return row ? { ...row } : null;
    },
    async findTicket(where, tx) {
      poolRule(tx, 'findTicket');
      const t = db.state.tickets.find((x) =>
        'code' in where ? x.code === where.code : x.id === where.id,
      );
      return t ? view(t) : null;
    },
    async searchTickets(eventId, term, limit) {
      return (
        db.state.tickets
          // Mirrors the repository: every reading of the term ORed.
          .filter(
            (t) =>
              t.eventId === eventId &&
              (t.attendeeName.toLowerCase().includes(term.name.toLowerCase()) ||
                (term.code !== null && t.code === term.code)),
          )
          .sort((a, b) => a.attendeeName.localeCompare(b.attendeeName) || a.position - b.position)
          .slice(0, limit)
          .map((t) => ({
            ticketId: t.id,
            attendeeName: t.attendeeName,
            ticketTypeName: db.state.types.get(t.ticketTypeId)?.name ?? '',
            status: t.status,
            checkedInAt: t.checkedInAt,
            checkedInBy: t.checkedInBy,
            phoneOnFile: Boolean(db.state.orders.find((o) => o.id === t.orderId)?.buyerPhone),
          }))
      );
    },
    async recentScans(passId, limit) {
      // Newest first by when it happened, like the repository.
      const when = (s: DoorScanRecord) =>
        (s.mode === 'offline' && s.scannedAt ? s.scannedAt : s.receivedAt).getTime();
      return scans
        .filter((s) => s.passId === passId)
        .reverse()
        .sort((a, b) => when(b) - when(a))
        .slice(0, limit)
        .map((s) => {
          // Same event only, like the repository's join.
          const t = db.state.tickets.find((x) => x.id === s.ticketId && x.eventId === s.eventId);
          return {
            scan: { ...s },
            attendeeName: t?.attendeeName ?? null,
            ticketTypeName: t ? (db.state.types.get(t.ticketTypeId)?.name ?? null) : null,
            stillCheckedInByThisScan: t?.checkedInScanId === s.scanId,
          };
        });
    },
    async offlineList(eventId) {
      return db.state.tickets
        .filter((t) => t.eventId === eventId)
        .sort((a, b) => a.attendeeName.localeCompare(b.attendeeName) || a.position - b.position)
        .map((t) => ({
          id: t.id,
          code: t.code,
          status: t.status,
          attendeeName: t.attendeeName,
          ticketTypeName: db.state.types.get(t.ticketTypeId)?.name ?? '',
          position: t.position,
          orderQuantity: db.state.orders.find((o) => o.id === t.orderId)?.quantity ?? 0,
          checkedInAt: t.checkedInAt,
          checkedInBy: t.checkedInBy,
        }));
    },
    async offlineConflicts(eventId) {
      // Mirrors the repository, including the superseded-request exclusion.
      return scans
        .filter(
          (s) =>
            s.eventId === eventId &&
            s.mode === 'offline' &&
            s.doorVerdict === 'admitted' &&
            s.result !== 'admitted' &&
            scans.find((x) => x.scanId === s.supersedesScanId)?.result !== 'admitted',
        )
        .map((s) => {
          const t = db.state.tickets.find((x) => x.id === s.ticketId && x.eventId === s.eventId);
          return {
            scanId: s.scanId,
            gate: passes.find((p) => p.id === s.passId)?.label ?? '',
            result: s.result,
            scannedAt: s.scannedAt,
            receivedAt: s.receivedAt,
            ticketId: s.ticketId,
            orderId: t?.orderId ?? null,
            attendeeName: t?.attendeeName ?? null,
            ticketTypeName: t ? (db.state.types.get(t.ticketTypeId)?.name ?? null) : null,
            priorCheckedInAt: s.priorCheckedInAt,
            priorCheckedInBy: s.priorCheckedInBy,
          };
        });
    },
    async counts(eventId) {
      const issued = db.state.tickets.filter((t) => t.eventId === eventId && t.status === 'issued');
      return { issued: issued.length, checkedIn: issued.filter((t) => t.checkedInAt).length };
    },
    async ticketsCheckedInByPass(passId, tx) {
      poolRule(tx, 'ticketsCheckedInByPass');
      const ids = new Set(scans.filter((s) => s.passId === passId).map((s) => s.scanId));
      return db.state.tickets.flatMap((t) =>
        t.checkedInScanId !== null && ids.has(t.checkedInScanId)
          ? [{ id: t.id, code: t.code, orderId: t.orderId, checkedInScanId: t.checkedInScanId }]
          : [],
      );
    },
  };

  /** The fake db's transaction, plus the door rows and the pool-rule flag. */
  const runInTransaction = async <T>(fn: (tx: DbExecutor) => Promise<T>): Promise<T> => {
    const snapshot = { passes: structuredClone(passes), scans: structuredClone(scans) };
    inTx = true;
    try {
      return await db.runInTransaction(fn);
    } catch (err) {
      passes = snapshot.passes;
      scans = snapshot.scans;
      throw err;
    } finally {
      inTx = false;
    }
  };

  /**
   * The orders repository for the door service, with the pool rule on the
   * audit insert too: inside a scan transaction it must carry `tx`.
   */
  const orders: Pick<FakeDb['orders'], 'insertEvent'> = {
    insertEvent: (values, tx) => {
      poolRule(tx, 'orders.insertEvent');
      return db.orders.insertEvent(values, tx);
    },
  };

  return {
    door,
    orders,
    runInTransaction,
    get passes() {
      return passes;
    },
    get scans() {
      return scans;
    },
  };
}
