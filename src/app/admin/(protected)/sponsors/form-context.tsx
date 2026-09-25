import Link from 'next/link';
import type { SponsorLevel } from '@/server/repositories/sponsors.repository';
import type { AdminSponsorGroup } from '@/server/services/sponsors.service';

/**
 * What the B15 form needs from the rest of the list: who is the presenting
 * partner now (hidden or not — saving another one demotes it either way),
 * and how many sponsors each level has besides the one being edited, which
 * is where "the end" of a level is.
 */
export function formContext(groups: AdminSponsorGroup[], editId: string | null) {
  const count = (level: SponsorLevel) =>
    groups.find((g) => g.level === level)?.sponsors.filter((s) => s.id !== editId).length ?? 0;
  const current = groups.find((g) => g.level === 'presenting')?.sponsors[0];
  return {
    presenting: current ? { id: current.id, name: current.name } : null,
    levelCounts: {
      presenting: count('presenting'),
      partner: count('partner'),
      supporter: count('supporter'),
    } satisfies Record<SponsorLevel, number>,
  };
}

/** The design's header: "Sponsors / <title>", the first part a way back to the list. */
export function SponsorsCrumb({ title }: { title: string }) {
  return (
    <>
      <Link
        href="/admin/sponsors"
        className="text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
      >
        Sponsors
      </Link>
      <span aria-hidden="true" className="text-muted-foreground">
        {' / '}
      </span>
      {title}
    </>
  );
}
