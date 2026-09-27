import Link from 'next/link';
import type { PolicyDoc } from './types';

/** Written to be true of this codebase — update it when the data model changes. */

const COLLECT: [string, string][] = [
  [
    'When you register',
    'Your name, email address and mobile number, the tickets you chose, and the order reference.',
  ],
  [
    'When you pay',
    'The bKash transaction ID and the mobile number you sent the money from. We never see your bKash PIN or balance.',
  ],
  [
    'On tickets',
    'The attendee name on each ticket, and any name changes, with the time they were made.',
  ],
  [
    'At the door',
    'When, and at which entrance, each ticket was checked in, and a log of every scan made at the door.',
  ],
  [
    'If you sign in',
    'Your email address; for each sign-in, the IP address and browser it came from; and a session cookie. There is no password.',
  ],
];

/** ADR-030: what a door phone shows. The phone digits are checked by the server, never displayed. */
const DOOR_STAFF_SEE: [string, string][] = [
  ['Attendee name', 'On every ticket they scan'],
  ['Ticket type', 'On every ticket they scan'],
  [
    'The last 3 digits of the phone that bought the ticket',
    'Never shown — when they look someone up by name they ask for them, and the system checks them',
  ],
  [
    'The ticket list kept on a door phone',
    'Attendee names and ticket types, and a saved copy of the gate page with its last scans, so the gate keeps working without signal — ticket codes only in scrambled form, and all of it deleted from the phone when its session ends',
  ],
  ['Printed backup list', 'Attendee names, ticket types, ticket codes and order references'],
];

export const privacy: PolicyDoc = {
  key: 'privacy',
  contactTitle: 'Questions about your data?',
  shortVersion: [
    'We collect what is needed to issue your tickets and check your payment, and nothing for advertising.',
    'We never see your bKash PIN or balance.',
    'The organizer sees your details; door staff see only what they need to let you in. Nothing is sold or shared for marketing.',
    'One cookie, and only if you sign in. No newsletter.',
    'You can ask what we hold about you, and ask us to correct or delete it.',
  ],
  intro: (
    <p>
      This site is run by a single organizer to sell tickets to their own events. It collects the
      minimum needed to do that and nothing for advertising.
    </p>
  ),
  sections: [
    {
      id: 'what-we-collect',
      title: 'What we collect',
      body: (
        <dl className="flex break-inside-avoid flex-col divide-y divide-border rounded-xl border border-border bg-card print:border-black">
          {COLLECT.map(([when, what]) => (
            <div key={when} className="flex flex-col gap-1 px-5 py-4 sm:flex-row sm:gap-6">
              <dt className="shrink-0 font-semibold sm:w-44">{when}</dt>
              <dd>{what}</dd>
            </div>
          ))}
        </dl>
      ),
    },
    {
      id: 'why',
      title: 'Why',
      body: (
        <p>
          To hold and issue your tickets, to match your payment against the bKash statement, to
          email you your order page and tickets, to check tickets in at the door (and print the
          backup list), and to reach you if the event changes. Your mobile number is also how{' '}
          <Link href="/orders/find">Find my order</Link> proves an order is yours.
        </p>
      ),
    },
    {
      id: 'who-sees-it',
      title: 'Who sees it',
      body: (
        <>
          <p>
            The organizer, when checking payments, answering your messages and running the door.
            Door staff see only what they need to let you in. Nobody else, and nothing is sold or
            shared for marketing.
          </p>
          <figure className="flex break-inside-avoid flex-col gap-2">
            {/* Outside the rounded box: `overflow-hidden` there would clip a <caption>. */}
            <figcaption
              id="door-staff-see"
              className="text-xs font-medium tracking-[0.14em] text-muted-foreground uppercase"
            >
              What door staff see
            </figcaption>
            <div className="overflow-hidden rounded-xl border border-border bg-card print:border-black">
              <table aria-labelledby="door-staff-see" className="w-full text-left">
                <tbody>
                  {DOOR_STAFF_SEE.map(([what, when], i) => (
                    <tr key={what}>
                      <th
                        scope="row"
                        className={`w-1/2 px-5 py-3 align-top font-semibold ${i ? 'border-t border-border' : ''}`}
                      >
                        {what}
                      </th>
                      <td className={`px-5 py-3 align-top ${i ? 'border-t border-border' : ''}`}>
                        {when}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </figure>
        </>
      ),
    },
    {
      id: 'where-it-lives',
      title: 'Where it lives',
      body: (
        <p>
          Order and ticket data is stored in our own database. Emails are sent through Amazon Web
          Services, which handles your email address for that purpose only. Event cover images are
          stored on Cloudflare. Nothing about you is sent to analytics or advertising services.
        </p>
      ),
    },
    {
      id: 'cookies',
      title: 'Cookies',
      body: (
        <p>
          One cookie, and only if you sign in: it keeps you signed in. (The phones door staff scan
          with get one more, holding their gate pass.) There are no tracking or advertising cookies.
        </p>
      ),
    },
    {
      id: 'emails',
      title: 'Emails',
      body: (
        <p>
          You receive emails about your order only: payment instructions, your tickets, a rejection
          if a payment could not be matched, a notice if your hold expires, news of a change to an
          event you hold tickets for, and sign-in links you asked for. There is no newsletter.
        </p>
      ),
    },
    {
      id: 'how-long-we-keep-it',
      title: 'How long we keep it',
      body: (
        <p>
          Order records — with the check-in record and the log of door scans — are kept after the
          event so that questions about payments and entry can be answered and the accounts
          reconciled. Ask, and we will delete the personal details on an order once the event has
          passed and no payment question is open.
        </p>
      ),
    },
    {
      id: 'your-rights',
      title: 'Your rights',
      body: (
        <p>
          Ask us what we hold about you, to correct it, or to delete it, using the contact details
          below. Quote your order reference if you have one.
        </p>
      ),
    },
  ],
};
