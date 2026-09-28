import { Link, Text } from '@react-email/components';
import { render } from '@react-email/components';
import { createElement, type ReactElement } from 'react';
import type { AccountEmail } from '@/server/auth/account-emails';
import { EmailLayout, styles } from './layout';
import type { EmailSender } from './view';

/**
 * ADR-038 — the admin account emails. Short, one action each, and each
 * says what to do if it was not you. They go to admins only.
 */
export type AccountEmailInput = AccountEmail & EmailSender & { ttlMinutes: number };

export const accountEmailSubjects = {
  'password-reset': 'Reset your echoandaura admin password',
  'confirm-new-email': 'Confirm your new echoandaura admin email',
  'email-change-notice': 'Your echoandaura admin email is being changed',
} as const satisfies Record<AccountEmail['kind'], string>;

function LinkBlock({ url, label }: { url: string; label: string }) {
  return (
    <>
      <Text style={{ margin: '16px 0' }}>
        <Link href={url} style={styles.buttonAccent}>
          {label}
        </Link>
      </Text>
      <Text style={styles.small}>
        If the button does not work, copy this into your browser:
        <br />
        {url}
      </Text>
    </>
  );
}

export function AccountEmailView({ v }: { v: AccountEmailInput }): ReactElement {
  switch (v.kind) {
    case 'password-reset':
      return (
        <EmailLayout
          preview="Choose a new password for the organizer console."
          sender={v}
          footerNote="If you did not ask for this, ignore it — your password stays as it is."
        >
          <Text style={styles.h1}>Reset your password</Text>
          <Text style={styles.p}>
            Someone asked to reset the password of the echoandaura organizer console for this
            address. The link works once and expires in {v.ttlMinutes} minutes. Choosing a new
            password signs you out everywhere.
          </Text>
          <LinkBlock url={v.url} label="Choose a new password" />
        </EmailLayout>
      );
    case 'confirm-new-email':
      return (
        <EmailLayout
          preview="Confirm this address for the organizer console."
          sender={v}
          footerNote="If you did not ask for this, ignore it — nothing changes unless the button is used."
        >
          <Text style={styles.h1}>Confirm your new email</Text>
          <Text style={styles.p}>
            This address was entered as the new sign-in email of an echoandaura organizer account.
            The change happens only when you confirm, within {v.ttlMinutes} minutes. Confirming
            signs you out everywhere; then sign in with this address.
          </Text>
          <LinkBlock url={v.url} label="Confirm this address" />
        </EmailLayout>
      );
    case 'email-change-notice':
      return (
        <EmailLayout
          preview="Your organizer email is being changed."
          sender={v}
          footerNote="This is a security notice. You cannot turn it off."
        >
          <Text style={styles.h1}>Your admin email is being changed</Text>
          <Text style={styles.p}>
            Someone signed in to your echoandaura organizer account asked to move it to{' '}
            <strong>{v.newEmail}</strong>. Nothing changes until that address confirms it.
          </Text>
          <Text style={styles.p}>
            <strong>If this was not you</strong>, sign in now and change your password: that signs
            everyone else out. If you cannot sign in, use “Forgot password?” on the sign-in page,
            and tell the organizer.
          </Text>
        </EmailLayout>
      );
  }
}

export async function renderAccountEmail(v: AccountEmailInput) {
  const element = createElement(AccountEmailView, { v });
  const [html, text] = await Promise.all([render(element), render(element, { plainText: true })]);
  return { subject: accountEmailSubjects[v.kind], html, text };
}
