import { SCAN_INPUT_MAX } from './door-rules';
import { TICKET_CODE_PATTERN } from './ticket-code-format';

/**
 * ADR-030: whatever a phone camera or a handheld (keyboard-wedge) scanner
 * produced, as a ticket code — or null. The ticket QR is the bare code
 * `TKT-XXXXXXXX`; people also type it lower-case, with spaces, without the
 * prefix, and a scanner pointed at a ticket-page link yields the URL.
 * Pure (no node:crypto): the door phone keys its retries by it too.
 */
export function parseScanToken(raw: string): string | null {
  if (raw.length === 0 || raw.length > SCAN_INPUT_MAX) return null;
  let s = raw.trim();
  const inUrl = /\/tickets\/([A-Za-z0-9-]+)/.exec(s);
  if (inUrl) s = inUrl[1]!;
  const upper = s.toUpperCase().replace(/[\s]+/g, '');
  const code = `TKT-${upper.replace(/^TKT-?/, '')}`;
  return TICKET_CODE_PATTERN.test(code) ? code : null;
}

/** What the scan log stores: the code when it parsed, never stray QR text. */
export function scanLogInput(raw: string, code: string | null): string {
  return code ?? `<unparsed:len=${raw.length}>`;
}
