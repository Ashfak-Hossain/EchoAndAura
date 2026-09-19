import QRCode from 'qrcode';

/**
 * QR of the ticket code, as an SVG string, for the ticket page and the PDF.
 * It encodes the code as plain text — nothing else — and is never the only
 * way in: door staff work from the printed list by name and code
 * (CLAUDE.md: no scanning at the gate). Rendered server-side, no client JS.
 */
export function ticketQrSvg(code: string): Promise<string> {
  return QRCode.toString(code, { type: 'svg', errorCorrectionLevel: 'M', margin: 1, width: 200 });
}
