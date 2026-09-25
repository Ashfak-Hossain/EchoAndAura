import type { Metadata } from 'next';
import { sponsorsService } from '@/server/container';
import { PageHeader } from '@/components/page-header';
import { saveSponsorAction } from '../actions';
import { SponsorsCrumb, formContext } from '../form-context';
import { SponsorForm } from '../sponsor-form';

export const metadata: Metadata = { title: 'Add sponsor' };
export const dynamic = 'force-dynamic';

// B15 "Add sponsor": a page, not a sheet — the form has a live preview column.
export default async function NewSponsorPage() {
  const { presenting, levelCounts } = formContext(await sponsorsService.listForAdmin(), null);

  return (
    <div className="flex flex-col gap-6">
      <PageHeader title={<SponsorsCrumb title="Add sponsor" />} />
      <SponsorForm
        action={saveSponsorAction.bind(null, null)}
        initial={{
          name: '',
          websiteUrl: '',
          level: 'supporter',
          tileTone: 'light',
          active: true,
          position: '',
        }}
        sponsor={null}
        presenting={presenting}
        levelCounts={levelCounts}
      />
    </div>
  );
}
