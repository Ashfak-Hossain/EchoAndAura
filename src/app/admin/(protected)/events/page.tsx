import Link from 'next/link';
import { eventsService } from '@/server/container';
import { formatDhaka } from '@/lib/time';

// TEMPORARY DEMO MARKUP — the real admin UI is designed separately.
export default async function AdminEventsPage() {
  const events = await eventsService.listEvents();

  return (
    <section className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">Events</h1>
        <Link href="/admin/events/new" className="rounded bg-black px-3 py-2 text-sm text-white">
          New event
        </Link>
      </div>

      {events.length === 0 ? (
        <p className="text-sm text-neutral-600">No events yet.</p>
      ) : (
        <table className="w-full text-left text-sm">
          <thead>
            <tr className="border-b">
              <th className="py-2">Title</th>
              <th className="py-2">Slug</th>
              <th className="py-2">Status</th>
              <th className="py-2">Starts (Dhaka)</th>
              <th className="py-2" />
            </tr>
          </thead>
          <tbody>
            {events.map((event) => (
              <tr key={event.id} className="border-b">
                <td className="py-2">{event.title}</td>
                <td className="py-2 font-mono text-xs">{event.slug}</td>
                <td className="py-2">{event.status}</td>
                <td className="py-2">{formatDhaka(event.startsAt)}</td>
                <td className="py-2 text-right">
                  <Link href={`/admin/events/${event.id}/edit`} className="underline">
                    Edit
                  </Link>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}
