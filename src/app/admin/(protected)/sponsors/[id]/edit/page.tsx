import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { sponsorsService } from '@/server/container';
import { PageHeader } from '@/components/page-header';
import { sponsorIdSchema } from '@/lib/validation/sponsors';
import { saveSponsorAction } from '../../actions';
import { SponsorsCrumb, formContext } from '../../form-context';
import { SponsorForm } from '../../sponsor-form';

export const metadata: Metadata = { title: 'Edit sponsor' };

interface Props {
  params: Promise<{ id: string }>;
}

// B15 edit: the same form, titled with the sponsor's name. One read — the
// list — gives the sponsor, the current presenting partner and the counts.
export default async function EditSponsorPage({ params }: Props) {
  const { id } = await params;
  // Reject malformed ids before they reach Postgres (invalid uuid → SQL error).
  if (!sponsorIdSchema.safeParse(id).success) notFound();

  const groups = await sponsorsService.listForAdmin();
  const sponsor = groups.flatMap((g) => g.sponsors).find((s) => s.id === id);
  if (!sponsor) notFound();
  const { presenting, levelCounts } = formContext(groups, sponsor.id);

  return (
    <div className="flex flex-col gap-6">
      <PageHeader title={<SponsorsCrumb title={sponsor.name} />} />
      <SponsorForm
        // A save elsewhere (another tab) re-seeds the form rather than
        // leaving stale values under a fresh page.
        key={sponsor.updatedAt.toISOString()}
        action={saveSponsorAction.bind(null, sponsor.id)}
        initial={{
          name: sponsor.name,
          websiteUrl: sponsor.websiteUrl ?? '',
          level: sponsor.level,
          tileTone: sponsor.tileTone,
          active: sponsor.active,
          position: String(sponsor.position),
        }}
        sponsor={{
          id: sponsor.id,
          name: sponsor.name,
          logo: { src: sponsor.logoUrl, width: sponsor.logoWidth, height: sponsor.logoHeight },
        }}
        presenting={presenting}
        levelCounts={levelCounts}
      />
    </div>
  );
}
