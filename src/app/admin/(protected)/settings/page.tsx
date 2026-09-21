import type { Metadata } from 'next';
import { settingsService } from '@/server/container';
import { PageHeader } from '@/components/page-header';
import { formatDhakaLong } from '@/lib/time';
import { saveSettingsAction, type SettingsFormValues } from './actions';
import { SettingsForm } from './settings-form';

export const metadata: Metadata = { title: 'Settings' };
export const dynamic = 'force-dynamic';

interface Props {
  searchParams: Promise<{ saved?: string }>;
}

// B14: one form, the effective values (saved or fallback) as defaults.
export default async function SettingsPage({ searchParams }: Props) {
  const [{ saved }, s] = await Promise.all([searchParams, settingsService.get()]);
  const defaults: SettingsFormValues = {
    bkashReceiveNumber: s.bkashReceiveNumber ?? '',
    bkashAccountName: s.bkashAccountName ?? '',
    bkashAccountType: s.bkashAccountType,
    supportEmail: s.supportEmail ?? '',
    supportPhone: s.supportPhone ?? '',
    facebookPageUrl: s.facebookPageUrl ?? '',
    verificationPromise: s.verificationPromise,
    organizerName: s.organizerName,
    organizerAddress: s.organizerAddress ?? '',
  };

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Settings"
        subtitle={
          s.updatedAt
            ? `Last saved ${formatDhakaLong(s.updatedAt)} (Dhaka) by ${s.updatedBy ?? 'unknown'}`
            : 'Not saved yet — showing the values the site started with.'
        }
      />
      <SettingsForm action={saveSettingsAction} defaultValues={defaults} saved={saved === '1'} />
    </div>
  );
}
