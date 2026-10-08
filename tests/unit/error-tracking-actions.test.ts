import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  InventoryStateError,
  OrderStatusConflictError,
  TrxIdAlreadyUsedError,
  TrxIdChangedError,
} from '@/server/lib/errors';
const mocks = vi.hoisted(() => ({
  submit: vi.fn(),
  approve: vi.fn(),
  report: vi.fn(),
  revalidate: vi.fn(),
}));
vi.mock('@/server/container', () => ({
  ordersService: { submitPayment: mocks.submit },
  fulfilmentService: { approveOrder: mocks.approve },
  doorService: {},
}));
vi.mock('@/server/lib/error-tracking', () => ({ reportError: mocks.report }));
vi.mock('@/server/lib/logger', () => ({ logger: { error: vi.fn() } }));
vi.mock('@/lib/session', () => ({ requireAdmin: async () => ({ email: 'admin@example.test' }) }));
vi.mock('next/cache', () => ({ revalidatePath: mocks.revalidate }));
vi.mock('next/navigation', () => ({
  redirect: (path: string) => {
    throw new Error(`redirect:${path}`);
  },
  notFound: () => {
    throw new Error('not found');
  },
}));
const { submitPaymentAction } = await import('@/app/(public)/orders/[id]/actions');
const { approveOrderAction } = await import('@/app/admin/(protected)/orders/[id]/actions');
const orderId = '00000000-0000-4000-8000-000000000001';
function payment(): FormData {
  const data = new FormData();
  data.set('trxId', 'AB12CD34E5');
  data.set('senderPhone', '01712345678');
  return data;
}
beforeEach(() => {
  vi.clearAllMocks();
  mocks.submit.mockReset().mockResolvedValue(undefined);
  mocks.approve.mockReset().mockResolvedValue(undefined);
});

describe('report only unexpected controller failures after the service settles', () => {
  it('reports a payment outage without changing the friendly result or exporting identifiers as tags', async () => {
    const error = new Error('buyer@example.com AB12CD34E5');
    let unwound = false;
    mocks.submit.mockImplementationOnce(async () => {
      unwound = true;
      throw error;
    });
    mocks.report.mockImplementationOnce(() => {
      expect(unwound).toBe(true);
    });
    const result = await submitPaymentAction(orderId, {}, payment());
    expect(result.banner?.title).toBe('We could not save your transaction ID');
    expect(mocks.report).toHaveBeenCalledExactlyOnceWith(error, 'payment.submit', {
      route: '/orders/[id]',
    });
  });
  it('does not report duplicate transaction IDs, status conflicts, invalid input or successful payment', async () => {
    mocks.submit.mockRejectedValueOnce(new TrxIdAlreadyUsedError('AB12CD34E5'));
    expect((await submitPaymentAction(orderId, {}, payment())).banner?.title).toContain(
      'already been used',
    );
    mocks.submit.mockRejectedValueOnce(new OrderStatusConflictError(orderId, 'expired'));
    await submitPaymentAction(orderId, {}, payment());
    await submitPaymentAction(orderId, {}, new FormData());
    expect(await submitPaymentAction(orderId, {}, payment())).toEqual({ submitted: true });
    expect(mocks.report).not.toHaveBeenCalled();
  });
  it('reports approval outages and invariant failures, without duplicating fulfilment or changing its arguments', async () => {
    const error = new Error('database outage with private SQL');
    mocks.approve.mockRejectedValueOnce(error);
    expect((await approveOrderAction(orderId, 'AB12CD34E5')).error).toContain(
      'Something went wrong',
    );
    expect(mocks.approve).toHaveBeenCalledWith(orderId, {
      actor: 'admin@example.test',
      verifiedTrxId: 'AB12CD34E5',
    });
    expect(mocks.report).toHaveBeenCalledExactlyOnceWith(error, 'admin.order', {
      route: '/admin/orders/[id]',
    });
    const invariant = new InventoryStateError('private-ticket-type', 'convertToSold');
    mocks.approve.mockRejectedValueOnce(invariant);
    expect((await approveOrderAction(orderId, 'AB12CD34E5')).error).toContain('sold count');
    expect(mocks.report).toHaveBeenLastCalledWith(invariant, 'admin.order', {
      route: '/admin/orders/[id]',
    });
  });
  it('does not report normal approval conflicts or successful redirect control flow', async () => {
    mocks.approve.mockRejectedValueOnce(new OrderStatusConflictError(orderId, 'paid'));
    await approveOrderAction(orderId, 'AB12CD34E5');
    mocks.approve.mockRejectedValueOnce(new TrxIdChangedError(orderId, 'AB12CD34E5', 'OTHER12345'));
    await approveOrderAction(orderId, 'AB12CD34E5');
    await expect(approveOrderAction(orderId, 'AB12CD34E5')).rejects.toThrow('redirect:');
    expect(mocks.report).not.toHaveBeenCalled();
  });
});
