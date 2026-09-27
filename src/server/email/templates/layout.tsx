import {
  Body,
  Container,
  Head,
  Hr,
  Html,
  Link,
  Preview,
  Section,
  Text,
} from '@react-email/components';
import type { ReactNode } from 'react';
import type { EmailSender } from './view';

/**
 * Canvas 4: 600 px, single column, system fonts only (Archivo does not
 * survive Gmail — weight carries the hierarchy). Tables and inline styles
 * come from @react-email/components. Black-on-white with one marigold
 * accent; no background images.
 */
export const FONT = "-apple-system, 'Helvetica Neue', Helvetica, Arial, sans-serif";

export const styles = {
  body: { margin: 0, backgroundColor: '#f4f2ed', fontFamily: FONT, color: '#1c1a17' },
  container: { width: '600px', maxWidth: '100%', margin: '0 auto', padding: '24px 16px' },
  card: {
    backgroundColor: '#ffffff',
    border: '1px solid #e3dfd7',
    borderRadius: '12px',
    padding: '28px',
  },
  brand: { fontSize: '18px', fontWeight: 700, letterSpacing: '-0.01em', margin: '0 0 18px' },
  h1: { fontSize: '24px', lineHeight: '1.2', fontWeight: 700, margin: '0 0 12px' },
  p: { fontSize: '15px', lineHeight: '1.55', margin: '0 0 12px' },
  small: { fontSize: '13px', lineHeight: '1.5', color: '#6b6558', margin: '0 0 8px' },
  label: {
    fontSize: '12px',
    letterSpacing: '0.08em',
    textTransform: 'uppercase' as const,
    color: '#6b6558',
    margin: '0 0 4px',
  },
  big: { fontSize: '28px', fontWeight: 700, margin: '0 0 4px' },
  mono: { fontFamily: "'Courier New', Courier, monospace", fontWeight: 700 },
  button: {
    display: 'inline-block',
    backgroundColor: '#1c1a17',
    color: '#ffffff',
    fontSize: '15px',
    fontWeight: 600,
    padding: '12px 20px',
    borderRadius: '8px',
    textDecoration: 'none',
  },
  buttonAccent: {
    display: 'inline-block',
    backgroundColor: '#eda43c',
    color: '#1c1a17',
    fontSize: '15px',
    fontWeight: 600,
    padding: '12px 20px',
    borderRadius: '8px',
    textDecoration: 'none',
  },
  hr: { borderColor: '#e3dfd7', margin: '20px 0' },
  callout: {
    backgroundColor: '#fdf3e0',
    border: '1px solid #f0d9ac',
    borderRadius: '8px',
    padding: '12px 14px',
    margin: '0 0 12px',
  },
  footer: { fontSize: '12px', lineHeight: '1.5', color: '#6b6558', margin: '16px 0 0' },
};

export interface LayoutProps {
  preview: string;
  sender: EmailSender;
  children: ReactNode;
  /** One sentence after the address line. */
  footerNote?: string;
}

export function EmailLayout({ preview, sender, children, footerNote }: LayoutProps) {
  const { siteUrl, contactEmail, contactPhone, organizerName, organizerAddress } = sender;
  const contact = [
    contactPhone ? `${organizerName} ${contactPhone}` : null,
    contactEmail,
    organizerAddress,
  ]
    .filter(Boolean)
    .join(' · ');
  return (
    <Html lang="en">
      <Head />
      <Preview>{preview}</Preview>
      <Body style={styles.body}>
        <Container style={styles.container}>
          <Section style={styles.card}>
            <Text style={styles.brand}>echoandaura</Text>
            {children}
          </Section>
          <Text style={styles.footer}>
            <Link href={siteUrl} style={{ color: '#6b6558' }}>
              echoandaura
            </Link>
            {contact ? ` · ${contact}` : ''}
            {footerNote ? ` · ${footerNote}` : ''}
          </Text>
        </Container>
      </Body>
    </Html>
  );
}

/** A label/value pair in the summary blocks. */
export function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <Text style={{ ...styles.p, margin: '0 0 6px' }}>
      <span style={{ color: '#6b6558' }}>{label} </span>
      {children}
    </Text>
  );
}

export { Hr };
