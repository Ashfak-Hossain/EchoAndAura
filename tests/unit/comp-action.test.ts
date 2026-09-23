import { beforeEach, describe, expect, it, vi } from 'vitest';
import { SoldOutError } from '@/server/lib/errors';

/**
 * B13 action wiring: the admin check comes first (a buyer session never
 * reaches the service), bad input never reaches it either, the actor is the
 * session's email — never a form field — and a sold-out refusal lands on the
 * quantity with the input kept. The service is mocked.
 */
const requireAdmin = vi.fn();
const issueComplimentaryTickets = vi.fn();

vi.mock('next/navigation', () => ({
  redirect: (url: string) => {
    throw new Error(`REDIRECT ${url}`);
  },
}));
vi.mock('next/cache', () => ({ revalidatePath: () => {} }));
vi.mock('@/lib/session', () => ({ requireAdmin: () => requireAdmin() }));
vi.mock('@/server/container', () => ({ fulfilmentService: { issueComplimentaryTickets } }));

const { issueComplimentaryTicketsAction } =
  await import('@/app/admin/(protected)/events/[id]/ticket-types/comp-actions');

const EVENT = '0b1c2d3e-4f5a-4b6c-8d7e-9f0a1b2c3d4e';
const TT = '5f0b1c2d-3e4f-4a5b-8c6d-7e8f9a0b1c2d';

function form(extra: Record<string, string> = {}): FormData {
  const f = new FormData();
  for (const [k, v] of Object.entries({
    ticketTypeId: TT,
    quantity: '2',
    guestName: 'Tahmina Akter',
    guestEmail: 'tahmina@dhakapress.com',
    reason: 'Press review',
    actor: 'someone-else@example.com',
    ...extra,
  })) {
    f.set(k, v);
  }
  return f;
}

beforeEach(() => {
  requireAdmin.mockReset().mockResolvedValue({ email: 'raj@example.com', role: 'admin' });
  issueComplimentaryTickets.mockReset();
});

describe('issueComplimentaryTicketsAction', () => {
  it('a non-admin is sent away before anything is read or issued', async () => {
    requireAdmin.mockRejectedValue(new Error('REDIRECT /'));
    await expect(issueComplimentaryTicketsAction(EVENT, {}, form())).rejects.toThrow('REDIRECT /');
    expect(issueComplimentaryTickets).not.toHaveBeenCalled();
  });

  it('issues as the signed-in admin and returns to the tab with the order', async () => {
    issueComplimentaryTickets.mockResolvedValue({ order: { id: 'order-1' }, tickets: [] });
    await expect(issueComplimentaryTicketsAction(EVENT, {}, form())).rejects.toThrow(
      `REDIRECT /admin/events/${EVENT}/edit?tab=ticket-types&comped=order-1`,
    );
    expect(issueComplimentaryTickets).toHaveBeenCalledWith({
      eventId: EVENT,
      ticketTypeId: TT,
      quantity: 2,
      guestName: 'Tahmina Akter',
      guestEmail: 'tahmina@dhakapress.com',
      reason: 'Press review',
      actor: 'raj@example.com',
    });
  });

  it('a missing reason is refused inline, input kept, service untouched', async () => {
    const state = await issueComplimentaryTicketsAction(EVENT, {}, form({ reason: '' }));
    expect(state).toMatchObject({ field: 'reason', values: { guestName: 'Tahmina Akter' } });
    expect(state.nonce).toBeTruthy();
    expect(issueComplimentaryTickets).not.toHaveBeenCalled();
  });

  it('a bound event id that is not a uuid never reaches the service', async () => {
    const state = await issueComplimentaryTicketsAction('../x', {}, form());
    expect(state.error).toBe('This event no longer exists.');
    expect(issueComplimentaryTickets).not.toHaveBeenCalled();
  });

  it('sold out lands on the quantity, with what was typed', async () => {
    issueComplimentaryTickets.mockRejectedValue(new SoldOutError(TT, 2));
    const state = await issueComplimentaryTicketsAction(EVENT, {}, form());
    expect(state).toMatchObject({ field: 'quantity', values: { reason: 'Press review' } });
    expect(state.error).toContain('Not enough left for 2');
  });
});
