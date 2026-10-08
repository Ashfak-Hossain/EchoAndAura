/**
 * ADR-043: the Content-Security-Policy every page gets, built per request
 * by src/proxy.ts.
 *
 * Scripts are the part that matters. Only scripts carrying this request's
 * nonce may run (Next stamps it on its own), and 'strict-dynamic' lets
 * those load their chunks. Anything injected into the page (a stored XSS
 * through an event description, say) has no nonce and is blocked.
 *
 * Styles stay 'unsafe-inline': the UI sets `style={…}` in many places, and
 * a style can't run code.
 */
export interface CspOptions {
  /** Base64, fresh for every request. */
  nonce: string;
  /** Where public covers and sponsor logos live (R2_PUBLIC_URL's origin), if set. */
  mediaOrigin: string | null;
  /**
   * The storage API (R2_ENDPOINT's origin). Admin uploads PUT the file
   * straight to it with a presigned URL (ADR-007), so admin pages only.
   */
  uploadOrigin: string | null;
  /** The gate scanner compiles its QR decoder from WebAssembly (ADR-030). */
  door: boolean;
  /**
   * The gate relay's WebSocket origin (ADR-058), e.g.
   * `wss://relay.echoandaura.com`. Door pages only.
   */
  relayOrigin?: string | null;
  /** Exact, validated hosted Sentry ingest origin; no wildcard or script exception. */
  errorOrigin?: string | null;
  /** `next dev`: React rebuilds server error stacks with eval. */
  dev: boolean;
}

export function buildCsp({
  nonce,
  mediaOrigin,
  uploadOrigin,
  door,
  relayOrigin = null,
  errorOrigin = null,
  dev,
}: CspOptions): string {
  const script = ["'self'", `'nonce-${nonce}'`, "'strict-dynamic'"];
  if (door) script.push("'wasm-unsafe-eval'");
  if (dev) script.push("'unsafe-eval'");

  const img = ["'self'", 'data:', 'blob:'];
  if (mediaOrigin) img.push(mediaOrigin);

  // 'self' covers the dev server's HMR websocket too (same host).
  const connect = ["'self'"];
  if (uploadOrigin) connect.push(uploadOrigin);
  if (door && relayOrigin) connect.push(relayOrigin);
  if (errorOrigin) connect.push(errorOrigin);

  const directives: [string, string[]][] = [
    ['default-src', ["'self'"]],
    ['script-src', script],
    ['style-src', ["'self'", "'unsafe-inline'"]],
    ['img-src', img],
    ['font-src', ["'self'"]],
    ['connect-src', connect],
    // ADR-048: the Turnstile widget's iframe. Its script needs no entry:
    // our nonce'd bundle injects it, which 'strict-dynamic' trusts.
    ['frame-src', ['https://challenges.cloudflare.com']],
    // The door's offline service worker (ADR-035).
    ['worker-src', ["'self'"]],
    ['manifest-src', ["'self'"]],
    ['object-src', ["'none'"]],
    ['base-uri', ["'self'"]],
    ['form-action', ["'self'"]],
    ['frame-ancestors', ["'none'"]],
  ];
  return directives.map(([name, values]) => `${name} ${values.join(' ')}`).join('; ');
}

/** `https://host.example.com/some/prefix` → `https://host.example.com`; null when unset or invalid. */
export function originFrom(value: string | undefined): string | null {
  const raw = value?.trim();
  if (!raw) return null;
  try {
    const url = new URL(raw);
    return url.protocol === 'https:' || url.protocol === 'http:' ? url.origin : null;
  } catch {
    return null;
  }
}

/** `https://relay.example.com` → `wss://relay.example.com` (http → ws); null when unset. */
export function wsOriginFrom(value: string | undefined): string | null {
  return originFrom(value)?.replace(/^http/, 'ws') ?? null;
}

/** A random UUID (122 random bits), base64 — what Next's CSP guide uses. */
export function newNonce(): string {
  return Buffer.from(crypto.randomUUID()).toString('base64');
}
