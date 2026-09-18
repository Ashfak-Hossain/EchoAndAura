import { describe, expect, it } from 'vitest';
import { eventStatus, orderStatus, ticketStatus } from '@/db/schema';
import {
  EVENT_STATUS_LABELS,
  ORDER_STATUS_LABELS,
  TICKET_STATUS_LABELS,
  TICKET_TYPE_SALE_STATE_LABELS,
  ticketTypeSaleState,
} from '@/lib/status-labels';

describe('status labels', () => {
  // Exhaustiveness: a new enum value in the schema fails here until it has a chip.
  it('covers every event, order and ticket status in the schema', () => {
    expect(Object.keys(EVENT_STATUS_LABELS).sort()).toEqual([...eventStatus.enumValues].sort());
    expect(Object.keys(ORDER_STATUS_LABELS).sort()).toEqual([...orderStatus.enumValues].sort());
    expect(Object.keys(TICKET_STATUS_LABELS).sort()).toEqual([...ticketStatus.enumValues].sort());
  });

  it('gives every entry a non-empty label', () => {
    for (const map of [
      EVENT_STATUS_LABELS,
      ORDER_STATUS_LABELS,
      TICKET_STATUS_LABELS,
      TICKET_TYPE_SALE_STATE_LABELS,
    ]) {
      for (const { label } of Object.values(map)) expect(label.length).toBeGreaterThan(0);
    }
  });
});

describe('ticketTypeSaleState', () => {
  const now = new Date('2026-09-18T10:00:00Z');
  const base = {
    quantityTotal: 100,
    quantitySold: 10,
    quantityReserved: 5,
    salesStartsAt: null,
    salesEndsAt: null,
  };

  it('is on sale by default', () => {
    expect(ticketTypeSaleState(base, now)).toBeNull();
  });

  it('reports sold out when available hits zero, counting holds', () => {
    expect(ticketTypeSaleState({ ...base, quantitySold: 95 }, now)).toBe('sold_out');
  });

  it('reports opens later before the window starts, and window ended after it ends', () => {
    expect(
      ticketTypeSaleState({ ...base, salesStartsAt: new Date('2026-09-19T00:00:00Z') }, now),
    ).toBe('opens_later');
    expect(ticketTypeSaleState({ ...base, salesEndsAt: now }, now)).toBe('window_ended');
    expect(
      ticketTypeSaleState({ ...base, salesEndsAt: new Date('2026-09-19T00:00:00Z') }, now),
    ).toBeNull();
  });

  it('sold out wins over window state', () => {
    expect(ticketTypeSaleState({ ...base, quantitySold: 95, salesEndsAt: now }, now)).toBe(
      'sold_out',
    );
  });
});
