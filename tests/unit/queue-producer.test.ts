import { describe, expect, it } from 'vitest';
import { EMAIL_JOB_OPTIONS, emailJobId, emailJobName } from '@/server/queue/producer';

describe('email job ids', () => {
  // BullMQ throws "Custom Id cannot contain :" — found live, not in unit tests.
  it('never contain a colon, are stable for first sends and unique for re-sends', () => {
    const id = emailJobId('tickets-issued', '1aa68663-94b8-48f3-8219-5ddbf5614905');
    expect(id).not.toContain(':');
    expect(emailJobId('tickets-issued', '1aa68663-94b8-48f3-8219-5ddbf5614905')).toBe(id);
    const resend = emailJobId('tickets-issued', '1aa68663-94b8-48f3-8219-5ddbf5614905', 123);
    expect(resend).not.toBe(id);
    expect(resend).not.toContain(':');
    expect(emailJobName('rejected')).toBe('email.rejected');
    expect(EMAIL_JOB_OPTIONS.attempts).toBe(5);
  });
});

describe('enqueueEmail', () => {
  it('rejects within the timeout when Redis never answers, instead of hanging the request', async () => {
    const stuck = { add: () => new Promise<never>(() => {}) };
    const { enqueueEmail } = await import('@/server/queue/producer');
    await expect(
      enqueueEmail('tickets-issued', '1aa68663-94b8-48f3-8219-5ddbf5614905', {
        queue: stuck,
        timeoutMs: 20,
      }),
    ).rejects.toThrow(/timed out/);
  });

  it('adds the job with the deterministic id and the retry options', async () => {
    const calls: unknown[][] = [];
    const q = { add: async (...args: unknown[]) => void calls.push(args) };
    const { enqueueEmail } = await import('@/server/queue/producer');
    await enqueueEmail('rejected', '1aa68663-94b8-48f3-8219-5ddbf5614905', { queue: q });
    expect(calls[0]?.[0]).toBe('email.rejected');
    expect(calls[0]?.[1]).toEqual({ orderId: '1aa68663-94b8-48f3-8219-5ddbf5614905' });
    expect(calls[0]?.[2]).toMatchObject({
      attempts: 5,
      jobId: 'rejected__1aa68663-94b8-48f3-8219-5ddbf5614905',
    });
  });
});
