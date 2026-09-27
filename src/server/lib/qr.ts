import QRCode from 'qrcode';

/**
 * QR of the ticket code, as an SVG string, for the ticket page and the PDF.
 * It encodes the code as plain text — nothing else: the gate scanner looks
 * the code up online (ADR-030), so it needs no signature, and tickets
 * already sent never need reissuing. It is never the only way in: door
 * staff can type the code, find the name, or use the printed list.
 * Rendered server-side, no client JS.
 */
export function ticketQrSvg(code: string): Promise<string> {
  return QRCode.toString(code, { type: 'svg', errorCorrectionLevel: 'M', margin: 1, width: 200 });
}

/**
 * ADR-030: the gate-pass link (`/door#code=…`) as a QR, for the organizer
 * to show a door phone. Admin screen only — the code is a credential.
 */
export function gatePassQrSvg(link: string): Promise<string> {
  return QRCode.toString(link, { type: 'svg', errorCorrectionLevel: 'M', margin: 1, width: 220 });
}
