import { eventsService, ticketTypesService } from '@/server/container';
import { type EventStatus, allowedEventTransitions } from '@/server/lib/event-status';
import { PUBLISH_CHECKS, describePublishProblem } from '@/server/lib/publish-readiness';
import type { EventRecord } from '@/server/repositories/events.repository';
import { Money } from '@/components/money';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { formatDhakaLong } from '@/lib/time';
import { changeEventStatusAction } from './actions';
import { type StatusButton, StatusButtons } from './status-buttons';

// Button copy per target status, from a given status. Rendered only for moves
// the state machine allows, so the page never offers an illegal transition.
const LABELS: Record<EventStatus, Record<EventStatus, string>> = {
  draft: { published: 'Publish', archived: 'Archive', draft: '' },
  published: { draft: 'Unpublish', archived: 'Archive', published: '' },
  archived: { draft: 'Restore to draft', published: '', archived: '' },
};

const HINTS: Partial<Record<EventStatus, string>> = {
  draft: 'Unpublish hides the page and stops new orders.',
  archived: 'Archive also ends the event for good.',
};

// B5 Publish tab: readiness checklist, actions, and how the share looks.
export async function StatusSection({ event }: { event: EventRecord }) {
  const [problems, ticketTypes] = await Promise.all([
    eventsService.publishReadinessFor(event.id),
    ticketTypesService.listForEvent(event.id),
  ]);
  const failing = new Set(problems.map((p) => p.code));
  const fromPrice = ticketTypes.length ? Math.min(...ticketTypes.map((t) => t.pricePaisa)) : null;
  const coverUrl = eventsService.coverImageUrl(event);

  const buttons: StatusButton[] = allowedEventTransitions(event.status).map((to) => ({
    to,
    label: LABELS[event.status][to],
    action: changeEventStatusAction.bind(null, event.id, to),
    destructive: to === 'archived',
    hint:
      to === 'draft' && event.status === 'published'
        ? HINTS.draft
        : to === 'archived'
          ? HINTS.archived
          : undefined,
    disabledReason:
      to === 'published' && problems.length > 0
        ? `Not ready: ${problems.map((p) => p.message).join('; ')}`
        : undefined,
    confirm:
      to === 'archived'
        ? {
            title: 'Archive this event?',
            description:
              'The public page goes read-only, no new orders can be made, issued tickets stay valid, and the check-in list stays exportable. You can restore it to draft later.',
            confirmLabel: 'Archive event',
          }
        : undefined,
  }));

  return (
    <section className="grid gap-6 lg:grid-cols-[3fr_2fr]" aria-labelledby="status-heading">
      <div className="flex flex-col gap-6">
        <Card className="gap-0 py-0">
          <CardHeader className="px-6 pt-6">
            <CardTitle id="status-heading">
              Status:{' '}
              <span className="font-mono font-normal" data-testid="event-status">
                {event.status}
              </span>
            </CardTitle>
            <CardDescription>
              {event.status === 'published'
                ? 'Live. Buyers can see the page and register while the window is open.'
                : 'Ready to publish? Everything below must pass.'}
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-5 px-6 pt-4 pb-6">
            {event.status !== 'published' ? (
              <ul className="flex flex-col gap-2 text-sm" aria-label="Publish readiness">
                {PUBLISH_CHECKS.map((code) => {
                  const bad = failing.has(code);
                  return (
                    <li key={code} className="flex items-start gap-3">
                      <span
                        className={
                          bad
                            ? 'flex size-5 shrink-0 items-center justify-center rounded-full bg-destructive-tint text-xs text-destructive'
                            : 'flex size-5 shrink-0 items-center justify-center rounded-full bg-success-tint text-xs text-success'
                        }
                      >
                        {bad ? '✗' : '✓'}
                      </span>
                      <span className={bad ? 'text-foreground' : 'text-muted-foreground'}>
                        {describePublishProblem(code)}
                      </span>
                    </li>
                  );
                })}
              </ul>
            ) : (
              <p className="text-sm text-muted-foreground">
                Public page: <span className="font-mono text-foreground">/events/{event.slug}</span>{' '}
                (available in Phase 2)
              </p>
            )}
            {problems.length > 0 && event.status !== 'published' ? (
              <p className="text-sm font-medium">
                Publishing is blocked by {problems.length}{' '}
                {problems.length === 1 ? 'problem' : 'problems'}.
              </p>
            ) : null}
            <StatusButtons buttons={buttons} />
          </CardContent>
        </Card>
      </div>

      <Card className="gap-0 py-0">
        <CardHeader className="px-6 pt-6">
          <CardTitle>How it looks shared on Facebook</CardTitle>
          <CardDescription>1200×630 crop of the cover, then title and summary.</CardDescription>
        </CardHeader>
        <CardContent className="px-6 pt-4 pb-6">
          <div className="overflow-hidden rounded-lg border border-border">
            {coverUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={coverUrl} alt="" className="aspect-1200/630 w-full object-cover" />
            ) : (
              <div className="flex aspect-1200/630 items-center justify-center bg-secondary text-sm text-muted-foreground">
                No cover image yet
              </div>
            )}
            <div className="flex flex-col gap-1 bg-secondary px-4 py-3">
              <span className="text-xs tracking-[0.08em] text-muted-foreground uppercase">
                echoandaura
              </span>
              <span className="font-heading font-semibold">{event.title}</span>
              <span className="text-sm text-muted-foreground">
                {formatDhakaLong(event.startsAt)}
                {event.venue ? ` · ${event.venue}` : ''}
                {fromPrice !== null ? (
                  <>
                    {' '}
                    · tickets from <Money paisa={fromPrice} />
                  </>
                ) : null}
              </span>
            </div>
          </div>
        </CardContent>
      </Card>
    </section>
  );
}
