/**
 * ADR-058: the gate relay as the e2e suite runs it — locally, by wrangler
 * (no Cloudflare account needed). The secret is test-only.
 */
export const RELAY_PORT = 8787;
export const RELAY_URL = `http://localhost:${RELAY_PORT}`;
export const RELAY_SECRET = 'e2e-only-relay-secret-not-used-anywhere-else-0123';
