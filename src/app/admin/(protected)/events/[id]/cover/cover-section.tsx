import { eventsService } from '@/server/container';
import type { EventRecord } from '@/server/repositories/events.repository';
import { CoverUpload } from './cover-upload';

// TEMPORARY DEMO MARKUP — becomes the "Cover image" tab of the event hub (B5).
export function CoverSection({ event }: { event: EventRecord }) {
  const url = eventsService.coverImageUrl(event);

  return (
    <section className="flex flex-col gap-3" aria-labelledby="cover-heading">
      <h2 id="cover-heading" className="text-lg font-semibold">
        Cover image
      </h2>
      {url ? (
        // Plain <img>: the storage host is env-defined, so next/image's
        // remotePatterns allow-list would need to follow it. Revisit in the UI slice.
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={url}
          alt={`Cover image for ${event.title}`}
          data-testid="cover-image"
          className="aspect-video max-w-md rounded border object-cover"
        />
      ) : (
        <p className="text-sm text-neutral-600" data-testid="no-cover-image">
          No cover image yet — required to publish.
        </p>
      )}
      <CoverUpload eventId={event.id} hasImage={url !== null} />
    </section>
  );
}
