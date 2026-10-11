/**
 * The activation proof (docs/ERROR-TRACKING.md): a fixed, recognisable error
 * for the admin diagnostics page. It carries no data, so a report shows only
 * this class name and the generic message.
 */
export class SyntheticTestError extends Error {
  constructor() {
    super('Synthetic error-tracking test');
    this.name = 'SyntheticTestError';
  }
}

/** Off unless ERROR_TRACKING_DIAGNOSTICS=1: the page and its actions do not exist otherwise. */
export function diagnosticsEnabled(env: Record<string, string | undefined> = process.env): boolean {
  return env.ERROR_TRACKING_DIAGNOSTICS === '1';
}
