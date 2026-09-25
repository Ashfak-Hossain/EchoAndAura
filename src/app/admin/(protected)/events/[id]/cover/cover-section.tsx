import Image from 'next/image';
import { eventsService } from '@/server/container';
import type { EventRecord } from '@/server/repositories/events.repository';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { CoverUpload } from './cover-upload';

// B5 Cover image tab: current cover card (or "none") + dropzone-styled input.
export function CoverSection({ event }: { event: EventRecord }) {
  const url = eventsService.coverImageUrl(event);

  return (
    <section className="grid gap-6 lg:grid-cols-2" aria-labelledby="cover-heading">
      <Card className="gap-0 py-0">
        <CardHeader className="px-6 pt-6">
          <CardTitle id="cover-heading">Current cover</CardTitle>
          <CardDescription>
            Shown on the event page and as the Facebook share image (1200×630 crop). Keep faces and
            type inside the middle — and no text in the image, because Bangla comes later.
          </CardDescription>
        </CardHeader>
        <CardContent className="px-6 pt-4 pb-6">
          {url ? (
            // Optimised like the public covers (ADR-033); every upload is a
            // new key, so a replaced cover can never show a cached old one.
            <Image
              src={url}
              alt={`Cover image for ${event.title}`}
              width={1200}
              height={630}
              sizes="(min-width: 1024px) 50vw, 100vw"
              loading="eager"
              data-testid="cover-image"
              className="aspect-video w-full rounded-lg border border-border object-cover"
            />
          ) : (
            <div
              data-testid="no-cover-image"
              className="flex aspect-video w-full items-center justify-center rounded-lg border border-dashed border-border-strong bg-secondary text-sm text-muted-foreground"
            >
              No cover image yet — required to publish.
            </div>
          )}
        </CardContent>
      </Card>

      <CoverUpload eventId={event.id} hasImage={url !== null} />
    </section>
  );
}
