import Link from 'next/link';
import { ArrowRight, BookOpen, Lightbulb, Map } from 'lucide-react';
import { HomeLayout } from 'fumadocs-ui/layouts/home';
import { TicketRace } from '@/components/ticket-race';
import { baseOptions } from '@/lib/layout.shared';

const PATHS = [
  {
    icon: Map,
    label: 'Guided tours',
    title: 'Buy a ticket',
    text: 'Follow one order from registration through manual payment, approval and email delivery.',
    href: '/docs/tours/buy-a-ticket/',
  },
  {
    icon: Lightbulb,
    label: 'Concepts',
    title: 'Who gets the last ticket?',
    text: 'See why one conditional UPDATE admits one buyer and refuses the other.',
    href: '/docs/concepts/last-ticket/',
  },
  {
    icon: BookOpen,
    label: 'Reference',
    title: 'Order states',
    text: 'The status contract: who owns the inventory at each step, and what ends an order.',
    href: '/docs/reference/order-states/',
  },
];

// The home layout wraps the page itself, not via a (home) route group: the
// group's name would put parentheses into exported file names, which the
// publication validator refuses (docs-artifact.mjs).
export default function Home() {
  return (
    <HomeLayout {...baseOptions()}>
      <div className="home">
        <section className="home-hero">
          <p className="eyebrow">ECHO & AURA · DEVELOPER DOCUMENTATION</p>
          <h1>
            A real system.
            <br />
            The reasoning behind it.
          </h1>
          <p className="home-lead">
            Understand how a ticket reservation, a manual payment, and a background job fit
            together. Follow the explanations into the code and tests.
          </p>
          <div className="home-actions">
            <Link className="home-primary" href="/docs/tours/buy-a-ticket/">
              Start with Buy a ticket <ArrowRight aria-hidden size={16} />
            </Link>
            <Link className="home-secondary" href="/docs/">
              How the system fits together
            </Link>
          </div>
        </section>

        <section aria-labelledby="paths" className="home-section">
          <h2 id="paths">Choose a path</h2>
          <ul className="home-paths">
            {PATHS.map(({ icon: Icon, label, title, text, href }) => (
              <li key={href}>
                <Link href={href} className="home-path">
                  <span className="home-path-label">
                    <Icon aria-hidden size={16} /> {label}
                  </span>
                  <strong>{title}</strong>
                  <span>{text}</span>
                </Link>
              </li>
            ))}
          </ul>
        </section>

        <section aria-labelledby="try" className="home-section">
          <h2 id="try">Try it: two buyers, one ticket</h2>
          <p className="home-section-lead">
            Step through the race the reservation query settles. The{' '}
            <Link href="/docs/concepts/last-ticket/">full concept</Link> shows the real query and
            the Postgres test behind it.
          </p>
          {/* The same article styles the race gets inside a docs page. */}
          <div className="prose home-race">
            <TicketRace />
          </div>
        </section>
      </div>
    </HomeLayout>
  );
}
