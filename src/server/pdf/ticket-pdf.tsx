import path from 'node:path';
import {
  Document,
  Font,
  Page,
  Path,
  StyleSheet,
  Svg,
  Text,
  View,
  renderToBuffer,
} from '@react-pdf/renderer';
import { formatDhakaLong, formatDhakaShort } from '@/lib/time';

/**
 * Fonts are bundled (OFL, see fonts/LICENSE.txt) and registered once at
 * module load: the built-in Helvetica is WinAnsi-only and turns a Bengali
 * name into Latin-1 garbage. react-pdf has no per-glyph fallback across
 * families, so each text run picks its family by script (`fontFor`).
 */
const FONT_DIR = path.join(process.cwd(), 'src/server/pdf/fonts');
Font.register({
  family: 'Ticket',
  fonts: [
    { src: path.join(FONT_DIR, 'NotoSans-Regular.ttf') },
    { src: path.join(FONT_DIR, 'NotoSans-Bold.ttf'), fontWeight: 'bold' },
  ],
});
Font.register({
  family: 'TicketBengali',
  fonts: [
    { src: path.join(FONT_DIR, 'NotoSansBengali-Regular.ttf') },
    { src: path.join(FONT_DIR, 'NotoSansBengali-Bold.ttf'), fontWeight: 'bold' },
  ],
});
// Never break a name or a code across lines.
Font.registerHyphenationCallback((word) => [word]);

const BENGALI = /[\u0980-\u09FF]/;
/** Noto Sans Bengali carries Latin glyphs too, so mixed runs stay in one face. */
export function fontFor(text: string): 'Ticket' | 'TicketBengali' {
  return BENGALI.test(text) ? 'TicketBengali' : 'Ticket';
}

/**
 * C5 — the printable ticket. A4, one page per ticket, black on white (the
 * only grey is the CANCELLED stamp, which must read as a stamp). The code is
 * set large enough to read across a table. Plain React with no `next/*`,
 * so the email worker can attach the same document later.
 */

export interface TicketPdfTicket {
  code: string;
  /** 1-based place within the order (tickets.position). */
  position: number;
  attendeeName: string;
  status: 'issued' | 'cancelled';
  /** SVG path data of the QR modules (from qrcode's svg output). */
  qrPath: string;
  qrViewBox: string;
}

export interface TicketPdfInput {
  eventTitle: string;
  startsAt: Date;
  endsAt: Date | null;
  venue: string | null;
  ticketTypeName: string;
  orderReference: string;
  registrationClosesAt: Date | null;
  issuedAt: Date;
  contactEmail: string | null;
  siteHost: string;
  tickets: TicketPdfTicket[];
}

const s = StyleSheet.create({
  page: { padding: 40, fontFamily: 'Ticket', fontSize: 11, color: '#000' },
  eyebrow: { fontSize: 9, letterSpacing: 1.5, textTransform: 'uppercase' },
  title: { fontSize: 26, fontWeight: 'bold', marginTop: 4 },
  brand: { fontSize: 11, fontWeight: 'bold', textAlign: 'right' },
  grid: { flexDirection: 'row', marginTop: 24, gap: 24 },
  col: { flex: 1, gap: 14 },
  label: { fontSize: 8, letterSpacing: 1, textTransform: 'uppercase', marginBottom: 2 },
  value: { fontSize: 13 },
  code: { fontSize: 32, fontFamily: 'Courier-Bold', letterSpacing: 1, marginTop: 2 },
  qrBox: { alignItems: 'center', gap: 6 },
  small: { fontSize: 9 },
  rule: { borderTopWidth: 1, borderTopColor: '#000', marginVertical: 18 },
  cut: {
    marginTop: 28,
    borderTopWidth: 1,
    borderTopStyle: 'dashed',
    borderTopColor: '#000',
    paddingTop: 6,
    fontSize: 8,
    letterSpacing: 2,
    textAlign: 'center',
  },
  h2: { fontSize: 12, fontWeight: 'bold', marginTop: 16, marginBottom: 6 },
  body: { fontSize: 10, lineHeight: 1.5 },
  footer: { position: 'absolute', bottom: 28, left: 40, right: 40, fontSize: 8 },
  stamp: {
    position: 'absolute',
    top: 120,
    left: 60,
    fontSize: 64,
    fontWeight: 'bold',
    color: '#000',
    opacity: 0.18,
    transform: 'rotate(-20deg)',
    letterSpacing: 6,
  },
  struck: { textDecoration: 'line-through' },
});

export function TicketPdf({ input }: { input: TicketPdfInput }) {
  return (
    <Document title={`${input.eventTitle} — tickets`} author="echoandaura">
      {input.tickets.map((t) => {
        const cancelled = t.status === 'cancelled';
        return (
          <Page key={t.code} size="A4" style={s.page}>
            {cancelled ? <Text style={s.stamp}>CANCELLED</Text> : null}
            <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
              <View>
                <Text style={s.eyebrow}>Admit one</Text>
                <Text style={[s.title, { fontFamily: fontFor(input.eventTitle) }]}>
                  {input.eventTitle}
                </Text>
              </View>
              <Text style={s.brand}>echoandaura</Text>
            </View>

            <View style={s.grid}>
              <View style={s.col}>
                <View>
                  <Text style={s.label}>Date & time (Dhaka)</Text>
                  <Text style={s.value}>{formatDhakaLong(input.startsAt)}</Text>
                </View>
                {input.venue ? (
                  <View>
                    <Text style={s.label}>Venue</Text>
                    <Text style={[s.value, { fontFamily: fontFor(input.venue) }]}>
                      {input.venue}
                    </Text>
                  </View>
                ) : null}
                <View>
                  <Text style={s.label}>Attendee</Text>
                  <Text style={[s.value, { fontFamily: fontFor(t.attendeeName) }]}>
                    {t.attendeeName}
                  </Text>
                </View>
                <View>
                  <Text style={s.label}>Ticket type</Text>
                  <Text style={[s.value, { fontFamily: fontFor(input.ticketTypeName) }]}>
                    {input.ticketTypeName}
                  </Text>
                </View>
                <View>
                  <Text style={s.label}>Ticket code</Text>
                  <Text style={[s.code, ...(cancelled ? [s.struck] : [])]}>{t.code}</Text>
                  <Text style={s.small}>
                    Order {input.orderReference} · ticket {t.position} of {input.tickets.length}
                  </Text>
                </View>
              </View>
              <View style={[s.col, s.qrBox]}>
                <Svg viewBox={t.qrViewBox} style={{ width: 160, height: 160 }}>
                  {/* qrcode draws modules as 1-unit strokes, not fills. */}
                  <Path d={t.qrPath} stroke="#000" strokeWidth={1} fill="none" />
                </Svg>
                <Text style={s.small}>{cancelled ? 'void' : 'the code, as a QR'}</Text>
              </View>
            </View>

            <View style={s.rule} />
            <Text style={s.body}>
              {cancelled
                ? 'This ticket was cancelled by the organizer and will not be admitted, even if printed. Refunds are handled outside the app.'
                : 'Show this at the door. Door staff find your name and code on the printed list — the QR is just the code, not a scanner requirement.'}
            </Text>
            {input.contactEmail ? (
              <Text style={[s.body, { marginTop: 4 }]}>{input.contactEmail}</Text>
            ) : null}

            <Text style={s.cut}>CUT HERE</Text>

            <Text style={s.h2}>Before you come</Text>
            <Text style={s.body}>
              Doors open before the first set starts at {formatDhakaShort(input.startsAt)}. The name
              on this ticket can be changed by the buyer
              {input.registrationClosesAt
                ? ` until registration closes on ${formatDhakaLong(input.registrationClosesAt)} (Dhaka)`
                : ' until registration closes'}
              ; after that the door list is printed and fixed. This ticket admits one person. There
              are no refunds through the app. Tickets cancelled by the organizer will not be
              admitted, even if this page has been printed.
            </Text>

            <Text style={s.footer}>
              echoandaura · {input.siteHost} · Issued {formatDhakaLong(input.issuedAt)} (Dhaka)
            </Text>
          </Page>
        );
      })}
    </Document>
  );
}

/** Render to a Buffer for a route response or an email attachment. */
export async function renderTicketPdf(input: TicketPdfInput): Promise<Buffer> {
  return renderToBuffer(<TicketPdf input={input} />);
}

/**
 * qrcode's SVG output is `<svg viewBox="0 0 N N"><path fill="#ffffff" …/><path stroke="#000000" d="…"/></svg>`
 * — the modules are one stroked path of unit-wide horizontal lines. Pull
 * that path and the viewBox out for react-pdf's own Svg primitives.
 */
export function qrSvgToPath(svg: string): { path: string; viewBox: string } {
  const viewBox = /viewBox="([^"]+)"/.exec(svg)?.[1] ?? '0 0 1 1';
  const paths = [...svg.matchAll(/<path[^>]*\sd="([^"]+)"[^>]*>/g)];
  // The dark modules are the last path (the first is the white background).
  const dark = paths.at(-1)?.[1] ?? '';
  return { path: dark, viewBox };
}
