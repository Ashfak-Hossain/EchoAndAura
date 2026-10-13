import { ScanLine, ShieldCheck, User } from 'lucide-react';
import type { ReactNode } from 'react';
import { AWS_S3_ICON, VENDOR_ICONS, type VendorIcon } from '@/lib/vendor-icons';

/**
 * The system on one page, grouped by who runs each part. Brand marks from
 * Simple Icons (lib/vendor-icons.ts); generic icons where a service has no
 * mark of its own. Plain HTML, so it reflows on a phone and every label is
 * text. It shows only what takes part: no hosts, keys or settings.
 */
interface Item {
  icon: VendorIcon | ReactNode;
  name: string;
  role: string;
}

interface Zone {
  id: string;
  title: string;
  note: string;
  tone: string;
  items: Item[];
}

const ZONES: Zone[] = [
  {
    id: 'people',
    title: 'People',
    note: 'Browsers and phones',
    tone: 'blue',
    items: [
      { icon: <User />, name: 'Buyers', role: 'Browse, register, pay by bKash, get tickets' },
      { icon: <ShieldCheck />, name: 'The organizer', role: 'Verifies payments in the admin area' },
      { icon: <ScanLine />, name: 'Door staff', role: 'Scan tickets with a gate pass' },
    ],
  },
  {
    id: 'cloudflare',
    title: 'Cloudflare',
    note: 'In front of everything',
    tone: 'amber',
    items: [
      {
        icon: 'cloudflare',
        name: 'DNS and proxy',
        role: 'TLS, firewall rules, rate limits, caching',
      },
      { icon: 'cloudflare', name: 'Access', role: 'An email check before the admin area' },
      { icon: 'cloudflare', name: 'Turnstile', role: 'The bot check on public forms' },
      { icon: 'cloudflare', name: 'Email', role: 'Sends order emails; forwards replies' },
      { icon: 'cloudflare', name: 'R2', role: 'Event covers, logos and nightly backups' },
      {
        icon: 'cloudflareworkers',
        name: 'Gate relay',
        role: 'Passes check-ins between door phones',
      },
      { icon: 'cloudflarepages', name: 'Pages', role: 'These docs' },
    ],
  },
  {
    id: 'server',
    title: 'One server',
    note: 'Dokploy runs the containers',
    tone: 'teal',
    items: [
      { icon: 'traefikproxy', name: 'Traefik', role: 'Routes requests to the app' },
      { icon: 'nextdotjs', name: 'web', role: 'The Next.js app: site, admin, door' },
      { icon: 'nodedotjs', name: 'worker', role: 'Emails, PDFs, hold expiry' },
      { icon: 'postgresql', name: 'Postgres 17', role: 'Orders, stock, tickets, audit' },
      { icon: 'redis', name: 'Redis 7', role: 'BullMQ queues, rate limits' },
    ],
  },
  {
    id: 'outside',
    title: 'Around it',
    note: 'Build, watch, keep a copy',
    tone: 'violet',
    items: [
      { icon: 'githubactions', name: 'GitHub Actions', role: 'Tests, builds and ships the images' },
      { icon: 'github', name: 'Container registry', role: 'The tested images the server pulls' },
      { icon: 'sentry', name: 'Sentry', role: 'Errors from browser, web and worker' },
      { icon: 'betterstack', name: 'Better Stack', role: 'Checks the site is up' },
      { icon: <AwsS3 />, name: 'Amazon S3', role: 'An off-site copy of the backups' },
    ],
  },
];

const FLOWS = [
  'Every request reaches the server through Cloudflare. The admin area also passes Access first.',
  'web and worker share Postgres and Redis; the worker takes jobs from the queues web fills.',
  'The worker sends email through Cloudflare, after each commit, never inside a request.',
  'Door phones talk to web for every check-in, and to the relay to hear other gates.',
  'Each night the database is backed up to R2, with an off-site copy in Amazon S3.',
  'GitHub Actions builds and tests the images; the server only pulls them.',
];

/** AWS's own icon, as published: its tile colour is part of the mark. */
function AwsS3() {
  return (
    <svg viewBox={AWS_S3_ICON.viewBox} aria-hidden="true" className="poster-aws">
      <rect width="40" height="40" fill={AWS_S3_ICON.tile} />
      <path transform={AWS_S3_ICON.glyphTransform} d={AWS_S3_ICON.d} fill="#FFFFFF" />
    </svg>
  );
}

function Icon({ icon }: { icon: Item['icon'] }) {
  if (typeof icon !== 'string') return <span className="poster-icon">{icon}</span>;
  const mark = VENDOR_ICONS[icon as VendorIcon];
  return (
    <span className="poster-icon">
      <svg viewBox="0 0 24 24" aria-hidden="true" fill="currentColor">
        <path d={mark.d} />
      </svg>
    </span>
  );
}

export function SystemPoster() {
  return (
    <figure className="system-poster">
      <div className="poster-zones">
        {ZONES.map((zone) => (
          <section
            key={zone.id}
            className={`poster-zone ${zone.tone}`}
            aria-labelledby={`zone-${zone.id}`}
          >
            <header>
              <h3 id={`zone-${zone.id}`}>{zone.title}</h3>
              <span>{zone.note}</span>
            </header>
            <ul>
              {zone.items.map((item) => (
                <li key={item.name}>
                  <Icon icon={item.icon} />
                  <span>
                    <strong>{item.name}</strong>
                    <small>{item.role}</small>
                  </span>
                </li>
              ))}
            </ul>
          </section>
        ))}
      </div>
      <figcaption>
        <strong>How they connect</strong>
        <ol>
          {FLOWS.map((flow) => (
            <li key={flow}>{flow}</li>
          ))}
        </ol>
      </figcaption>
    </figure>
  );
}
