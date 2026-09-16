import { createEventAction } from '../actions';
import { EventForm } from '../event-form';

// TEMPORARY DEMO MARKUP — the real admin UI is designed separately.
export default function NewEventPage() {
  return (
    <section className="flex flex-col gap-4">
      <h1 className="text-xl font-semibold">New event</h1>
      <EventForm action={createEventAction} submitLabel="Create event" />
    </section>
  );
}
