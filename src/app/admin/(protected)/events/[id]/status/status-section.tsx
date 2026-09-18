import { eventsService } from '@/server/container';
import { type EventStatus, allowedEventTransitions } from '@/server/lib/event-status';
import { PUBLISH_CHECKS, describePublishProblem } from '@/server/lib/publish-readiness';
import type { EventRecord } from '@/server/repositories/events.repository';
import { changeEventStatusAction } from './actions';
import { type StatusButton, StatusButtons } from './status-buttons';

// Button copy per target status, from a given status. Rendered only for moves
// the state machine allows, so the page never offers an illegal transition.
const LABELS: Record<EventStatus, Record<EventStatus, string>> = {
  draft: { published: 'Publish', archived: 'Archive', draft: '' },
  published: { draft: 'Unpublish', archived: 'Archive', published: '' },
  archived: { draft: 'Restore to draft', published: '', archived: '' },
};

// TEMPORARY DEMO MARKUP — becomes the "Publish" tab of the event hub (B5).
export async function StatusSection({ event }: { event: EventRecord }) {
  const problems = await eventsService.publishReadinessFor(event.id);
  const failing = new Set(problems.map((p) => p.code));

  const buttons: StatusButton[] = allowedEventTransitions(event.status).map((to) => ({
    to,
    label: LABELS[event.status][to],
    action: changeEventStatusAction.bind(null, event.id, to),
    destructive: to === 'archived',
    disabledReason:
      to === 'published' && problems.length > 0
        ? `Not ready: ${problems.map((p) => p.message).join('; ')}`
        : undefined,
  }));

  return (
    <section className="flex flex-col gap-3" aria-labelledby="status-heading">
      <h2 id="status-heading" className="text-lg font-semibold">
        Status:{' '}
        <span className="font-mono" data-testid="event-status">
          {event.status}
        </span>
      </h2>

      {event.status === 'published' ? (
        <p className="text-sm text-neutral-600">
          Public page: <span className="font-mono">/events/{event.slug}</span> (available in
          Phase 2)
        </p>
      ) : null}

      {event.status !== 'published' ? (
        <ul className="text-sm" aria-label="Publish readiness">
          {PUBLISH_CHECKS.map((code) => (
            <li key={code} className={failing.has(code) ? 'text-red-600' : 'text-green-700'}>
              {failing.has(code) ? '✗' : '✓'} {describePublishProblem(code)}
            </li>
          ))}
        </ul>
      ) : null}

      <StatusButtons buttons={buttons} />
    </section>
  );
}
