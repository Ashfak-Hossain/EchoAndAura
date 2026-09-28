import { describe, expect, it } from 'vitest';
import { createHealthService } from '@/server/services/health.service';

const up = async () => undefined;
const down = async () => {
  throw new Error('connect ECONNREFUSED 10.0.0.5:5432 as user echoandaura');
};
const hangs = () => new Promise<void>(() => undefined);

describe('health service (ADR-036)', () => {
  it('is ok when Postgres, Redis and the worker all answer', async () => {
    const health = createHealthService({ database: up, queue: up, worker: up });
    expect(await health.check()).toEqual({ ok: true, database: true, queue: true, worker: true });
  });

  it('is not ok when Postgres is down', async () => {
    const health = createHealthService({ database: down, queue: up, worker: up });
    expect(await health.check()).toEqual({ ok: false, database: false, queue: true, worker: true });
  });

  it('is not ok when Redis is down: orders stand, but their emails cannot be queued', async () => {
    const health = createHealthService({ database: up, queue: down, worker: up });
    expect(await health.check()).toEqual({ ok: false, database: true, queue: false, worker: true });
  });

  it('answers within the timeout when a probe hangs, and still reports the other', async () => {
    const health = createHealthService({ database: hangs, queue: up, worker: up }, 20);
    const started = Date.now();
    expect(await health.check()).toEqual({ ok: false, database: false, queue: true, worker: true });
    expect(Date.now() - started).toBeLessThan(1_000);
  });

  it('is not ok when the worker is gone (ADR-040): emails would queue but never send', async () => {
    const health = createHealthService({ database: up, queue: up, worker: down });
    expect(await health.check()).toEqual({ ok: false, database: true, queue: true, worker: false });
  });

  it('a hung worker probe does not hang the check', async () => {
    const health = createHealthService({ database: up, queue: up, worker: hangs }, 20);
    expect(await health.check()).toEqual({ ok: false, database: true, queue: true, worker: false });
  });

  it('never passes an error message on (it could name a host or a user)', async () => {
    const health = createHealthService({ database: down, queue: down, worker: down });
    expect(JSON.stringify(await health.check())).not.toMatch(/ECONNREFUSED|echoandaura|10\.0/);
  });
});
