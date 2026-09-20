import type { Metadata } from 'next';
import { eventsService } from '@/server/container';
import { ButtonLink } from '@/components/button-link';
import { EmptyState } from '@/components/empty-state';
import { siteUrl } from '@/lib/env.public';
import { ArchiveGrid } from './archive-grid';

export const metadata: Metadata = {
  title: 'Past events',
  description: 'Every echoandaura show so far.',
  alternates: { canonical: `${siteUrl()}/archive` },
};

// Reads the database on every request: a show moves here the moment it starts.
export const dynamic = 'force-dynamic';

/** A6 — the archive. Proof the shows are real, even in a quiet month. */
export default async function ArchivePage() {
  const events = await eventsService.getArchivePage();
  return (
    <main className="mx-auto flex w-full max-w-180 flex-1 flex-col gap-8 px-4 py-10 lg:py-16">
      <header className="flex flex-col gap-2">
        <p className="font-mono text-xs tracking-[0.14em] text-muted-foreground uppercase">
          Archive
        </p>
        <h1 className="font-heading text-[32px] leading-tight font-bold tracking-[-0.02em] lg:text-[40px]">
          Past events
        </h1>
      </header>
      {events.length > 0 ? (
        <ArchiveGrid events={events} />
      ) : (
        <EmptyState
          icon="↺"
          title="No past events yet"
          description="Shows move here the morning after they happen."
          action={
            <ButtonLink href="/" variant="secondary">
              See upcoming events
            </ButtonLink>
          }
        />
      )}
    </main>
  );
}
