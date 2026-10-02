import type { Metadata } from 'next';
import { PageHeader } from '@/components/page-header';
import { requireAdmin } from '@/lib/session';
import { EMAIL_CHANGE_TTL_SECONDS } from '@/server/auth/account-emails';
import { ChangeEmailForm, ChangePasswordForm, TwoFactorForm } from './account-forms';

export const metadata: Metadata = { title: 'Your account' };
export const dynamic = 'force-dynamic';

interface Props {
  searchParams: Promise<{ password?: string }>;
}

// ADR-038: the signed-in admin's own password and sign-in email; ADR-049:
// their backup codes (requireAdmin means two-factor is on).
export default async function AccountPage({ searchParams }: Props) {
  const [admin, { password }] = await Promise.all([requireAdmin(), searchParams]);
  return (
    <div className="flex flex-col gap-6">
      <PageHeader title="Your account" subtitle={`Signed in as ${admin.email}`} />
      <div className="flex max-w-190 flex-col gap-6">
        <ChangePasswordForm changed={password === 'changed'} />
        <ChangeEmailForm current={admin.email} ttlMinutes={EMAIL_CHANGE_TTL_SECONDS / 60} />
        <TwoFactorForm />
      </div>
    </div>
  );
}
