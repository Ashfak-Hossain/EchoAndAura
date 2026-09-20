import { Link, Text } from '@react-email/components';
import { render } from '@react-email/components';
import { createElement } from 'react';
import { EmailLayout, styles } from './layout';

/** C6 — the magic link. Short, one button, states the 15-minute expiry. */
export interface SignInEmailInput {
  url: string;
  siteUrl: string;
  contactEmail: string | null;
  contactPhone: string | null;
  ttlMinutes: number;
}

export const subject = 'Sign in to echoandaura';

export function SignInEmail({ v }: { v: SignInEmailInput }) {
  return (
    <EmailLayout
      preview="Your sign-in link — it works once and expires soon."
      contactEmail={v.contactEmail}
      contactPhone={v.contactPhone}
      siteUrl={v.siteUrl}
      footerNote="If you did not ask for this, ignore it — nobody can sign in without this email."
    >
      <Text style={styles.h1}>Sign in to echoandaura</Text>
      <Text style={styles.p}>
        Tap the button to see your orders and tickets. The link works once and expires in{' '}
        {v.ttlMinutes} minutes.
      </Text>
      <Text style={{ margin: '16px 0' }}>
        <Link href={v.url} style={styles.buttonAccent}>
          Sign in
        </Link>
      </Text>
      <Text style={styles.small}>
        If the button does not work, copy this into your browser:
        <br />
        {v.url}
      </Text>
    </EmailLayout>
  );
}

export async function renderSignInEmail(v: SignInEmailInput) {
  const element = createElement(SignInEmail, { v });
  const [html, text] = await Promise.all([render(element), render(element, { plainText: true })]);
  return { subject, html, text };
}
