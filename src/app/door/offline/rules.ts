import { DOOR_UNDO_WINDOW_MS } from '@/server/lib/door-rules';
import type { OutboxItem } from './store';

/**
 * ADR-034: the door phone's two bookkeeping rules, pure so they are tested
 * without a browser.
 */

/**
 * A list's "as of" is the server's clock, a mark's `knownSince` this
 * phone's corrected one — good to about half a round trip. A mark
 * outlives the list by this much rather than risk forgetting someone this
 * gate let in.
 */
export const MARK_GRACE_MS = 15_000;

/**
 * May a new list (read as of `listAsOf`, server clock) replace this phone's
 * own "already in" mark? Only once the server is known to have had the
 * check-in before the list was read. Never by when the person walked in:
 * an offline admit can be long before the server heard of it.
 */
export function listCovers(knownSince: number | null, listAsOf: number): boolean {
  return knownSince !== null && knownSince + MARK_GRACE_MS < listAsOf;
}

/** `sent`: it went to the server at least once — only the online undo is safe now. */
export type OfflineUndo = 'done' | 'sent' | 'not_found';

/**
 * May the door undo this outbox scan on the phone (sending it as UNDONE)?
 * Not once it was sent, even unanswered: the ADMIT may already stand on
 * the server, and a later UNDONE under the same scan id cannot take it back.
 */
export function localUndo(
  item: Pick<OutboxItem, 'verdict' | 'attempted' | 'scannedAt'> | undefined,
  now: number,
  inFlight: boolean,
): OfflineUndo {
  if (!item || item.verdict !== 'admitted') return 'not_found';
  if (item.attempted || inFlight) return 'sent';
  if (now - Date.parse(item.scannedAt) > DOOR_UNDO_WINDOW_MS) return 'not_found';
  return 'done';
}
