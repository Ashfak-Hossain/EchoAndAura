import { describe, expect, it } from 'vitest';
import { ticketQrSvg } from '@/server/lib/qr';
import {
  type TicketPdfInput,
  fontFor,
  qrSvgToPath,
  renderTicketPdf,
} from '@/server/pdf/ticket-pdf';

async function input(over: Partial<TicketPdfInput> = {}): Promise<TicketPdfInput> {
  const qr = qrSvgToPath(await ticketQrSvg('TKT-4H8ZP2XQ'));
  return {
    eventTitle: 'Echo & Aura Live — Dhaka',
    startsAt: new Date('2026-10-01T13:00:00Z'),
    endsAt: null,
    venue: 'ICCB Hall 4, Dhaka',
    ticketTypeName: 'General',
    orderReference: 'EA-7K3M9Q',
    registrationClosesAt: new Date('2026-09-26T17:59:00Z'),
    issuedAt: new Date('2026-09-17T05:20:00Z'),
    contactEmail: 'hello@example.com',
    siteHost: 'echoandaura.com',
    tickets: [
      {
        code: 'TKT-4H8ZP2XQ',
        position: 1,
        attendeeName: 'Nusrat Jahan',
        status: 'issued',
        qrPath: qr.path,
        qrViewBox: qr.viewBox,
      },
      {
        code: 'TKT-9WQ2LM5D',
        position: 2,
        attendeeName: 'Tanvir Alam',
        status: 'cancelled',
        qrPath: qr.path,
        qrViewBox: qr.viewBox,
      },
    ],
    ...over,
  };
}

describe('qrSvgToPath', () => {
  it('extracts the module path and viewBox from qrcode output', async () => {
    const svg = await ticketQrSvg('TKT-4H8ZP2XQ');
    const { path, viewBox } = qrSvgToPath(svg);
    expect(viewBox).toMatch(/^0 0 \d+ \d+$/);
    expect(path.startsWith('M')).toBe(true);
    expect(path.length).toBeGreaterThan(100);
  });
});

describe('renderTicketPdf', () => {
  it('renders one A4 page per ticket as a real PDF', async () => {
    const buf = await renderTicketPdf(await input());
    expect(buf.subarray(0, 5).toString()).toBe('%PDF-');
    // Two /Type /Page objects (not /Pages) — one per ticket.
    const pages = buf.toString('latin1').match(/\/Type\s*\/Page[^s]/g) ?? [];
    expect(pages).toHaveLength(2);
    expect(buf.byteLength).toBeGreaterThan(5_000);
  });

  // A Dhaka audience: names, titles and venues are often Bengali. The
  // built-in Helvetica would encode them as Latin-1 garbage.
  it('embeds a Unicode TrueType font so Bengali names render', async () => {
    const base = await input();
    const buf = await renderTicketPdf({
      ...base,
      eventTitle: 'ইকো অ্যান্ড অরা লাইভ — ঢাকা',
      tickets: [{ ...base.tickets[0]!, attendeeName: 'নুসরাত জাহান' }],
    });
    const text = buf.toString('latin1');
    expect(text).toMatch(/\/FontFile2/); // embedded TrueType, not a base-14 font
    expect(fontFor('নুসরাত জাহান')).toBe('TicketBengali');
    expect(fontFor('Nusrat Jahan')).toBe('Ticket');
    expect(fontFor('Nusrat নুসরাত')).toBe('TicketBengali');
  });
});
