import { render } from '@react-email/components';
import { createElement } from 'react';
import * as expired from './expired';
import * as paymentInstructions from './payment-instructions';
import * as rejected from './rejected';
import * as ticketsIssued from './tickets-issued';
import type { EmailView } from './view';

export type EmailKind = 'payment-instructions' | 'tickets-issued' | 'rejected' | 'expired';

export const EMAIL_KINDS: readonly EmailKind[] = [
  'payment-instructions',
  'tickets-issued',
  'rejected',
  'expired',
];

export interface RenderedEmail {
  subject: string;
  html: string;
  text: string;
}

const TEMPLATES = {
  'payment-instructions': {
    subject: paymentInstructions.subject,
    component: paymentInstructions.PaymentInstructionsEmail,
  },
  'tickets-issued': { subject: ticketsIssued.subject, component: ticketsIssued.TicketsIssuedEmail },
  rejected: { subject: rejected.subject, component: rejected.RejectedEmail },
  expired: { subject: expired.subject, component: expired.ExpiredEmail },
} as const;

/** Pure: a view in, subject + HTML + plain text out. */
export async function renderEmail(kind: EmailKind, v: EmailView): Promise<RenderedEmail> {
  const t = TEMPLATES[kind];
  const element = createElement(t.component, { v });
  const [html, text] = await Promise.all([render(element), render(element, { plainText: true })]);
  return { subject: t.subject(v), html, text };
}
