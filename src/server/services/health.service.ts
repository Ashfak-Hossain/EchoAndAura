/**
 * ADR-036: is the site able to take an order right now? The uptime monitor
 * asks this every minute and alerts when it says no. Postgres down means
 * nothing works; Redis down means orders stand but their emails cannot be
 * queued — both are worth waking someone for.
 *
 * Only booleans leave here: a health endpoint is public, and an error
 * message could name a host or a user.
 */

export interface HealthProbes {
  /** Resolves when Postgres answers a query. */
  database(): Promise<void>;
  /** Resolves when Redis answers a PING. */
  queue(): Promise<void>;
}

export interface HealthReport {
  ok: boolean;
  database: boolean;
  queue: boolean;
}

/** A probe slower than this counts as down: the monitor must get an answer, not a hang. */
export const HEALTH_TIMEOUT_MS = 2_000;

function within(probe: () => Promise<void>, ms: number): Promise<boolean> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<boolean>((resolve) => {
    timer = setTimeout(() => resolve(false), ms);
  });
  const run = (async () => {
    try {
      await probe();
      return true;
    } catch {
      return false;
    }
  })();
  return Promise.race([run, timeout]).finally(() => clearTimeout(timer));
}

export function createHealthService(probes: HealthProbes, timeoutMs = HEALTH_TIMEOUT_MS) {
  return {
    async check(): Promise<HealthReport> {
      // Side by side: a hung Postgres must not hide the state of Redis.
      const [database, queue] = await Promise.all([
        within(probes.database, timeoutMs),
        within(probes.queue, timeoutMs),
      ]);
      return { ok: database && queue, database, queue };
    },
  };
}

export type HealthService = ReturnType<typeof createHealthService>;
