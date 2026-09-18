import type { Metadata } from 'next';
import { PageHeader } from '@/components/page-header';
import { createEventAction } from '../actions';
import { EventForm } from '../event-form';

export const metadata: Metadata = { title: 'New event' };

// B5 "new" state: only Details exists until the event is saved; the other
// tabs appear on the editor once there is an id.
export default function NewEventPage() {
  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="New event"
        subtitle="Save the details first — cover image, ticket types and publishing come next."
      />
      <EventForm action={createEventAction} submitLabel="Create event" />
    </div>
  );
}
