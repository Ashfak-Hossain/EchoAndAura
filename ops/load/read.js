// Phase 7.5 (docs/LOAD-TEST.md): the public pages at a steady arrival rate.
// Run it at several RATEs to find where response times bend.
//
//   docker compose -f ops/load/docker-compose.yml run --rm k6 run -e RATE=10 /scripts/read.js
//
// RATE is page views per second; DURATION defaults to 60s. Each view is one
// HTML page: k6 does not fetch images, scripts or styles (Cloudflare and the
// browser cache serve those in production), so this is the server's work.
import http from 'k6/http';
import { check } from 'k6';
import { Counter } from 'k6/metrics';

const BASE = __ENV.BASE_URL || 'http://web:3000';
const EVENT = __ENV.EVENT_SLUG || 'load-test-night';
const RATE = Number(__ENV.RATE || 10);

// A launch-day mix: people land on the event from Facebook, some open the
// home page, some go on to the form.
// PATHS=/,/events,/faq replaces the mix with equal weights: for the gentle
// production check, where the load-test event does not exist.
const MIX = [
  { name: 'event', path: `/events/${EVENT}`, weight: 5 },
  { name: 'home', path: '/', weight: 3 },
  { name: 'register', path: `/events/${EVENT}/register`, weight: 2 },
  { name: 'events', path: '/events', weight: 1 },
];
const PAGES = __ENV.PATHS
  ? __ENV.PATHS.split(',').map((path) => ({ name: path, path, weight: 1 }))
  : MIX;
const TOTAL = PAGES.reduce((n, p) => n + p.weight, 0);

export const options = {
  scenarios: {
    views: {
      executor: 'constant-arrival-rate',
      rate: RATE,
      timeUnit: '1s',
      duration: __ENV.DURATION || '60s',
      preAllocatedVUs: Math.max(20, RATE * 2),
      maxVUs: Math.max(100, RATE * 20),
    },
  },
  summaryTrendStats: ['med', 'p(95)', 'p(99)', 'max'],
  thresholds: {
    http_req_failed: ['rate<0.01'],
    http_req_duration: ['p(95)<1000'],
    // Only the pages actually served (not the instant 429s): what an
    // admitted visitor waits.
    'http_req_duration{expected_response:true}': ['p(95)<1000'],
  },
};

function pick() {
  let r = Math.random() * TOTAL;
  for (const p of PAGES) {
    r -= p.weight;
    if (r < 0) return p;
  }
  return PAGES[0];
}

// Load shedding (Phase 7.6): Traefik's inFlightReq answers 429 at once when
// the web already has its cap of requests in flight. Counted apart from
// real failures: "busy, try again" is the designed answer to overload.
const busy = new Counter('busy_429');

export default function view() {
  const page = pick();
  const res = http.get(`${BASE}${page.path}`, { tags: { page: page.name } });
  if (res.status === 429) busy.add(1);
  check(res, { 'status 200': (r) => r.status === 200 });
}

export function handleSummary(data) {
  const d = data.metrics.http_req_duration.values;
  const line = {
    rate: RATE,
    requests: data.metrics.http_reqs.values.count,
    achievedRps: Number(data.metrics.http_reqs.values.rate.toFixed(1)),
    failedPct: Number((data.metrics.http_req_failed.values.rate * 100).toFixed(2)),
    medMs: Math.round(d.med),
    p95Ms: Math.round(d['p(95)']),
    p99Ms: Math.round(d['p(99)']),
    maxMs: Math.round(d.max),
    droppedIterations: data.metrics.dropped_iterations
      ? data.metrics.dropped_iterations.values.count
      : 0,
    busy429: data.metrics.busy_429 ? data.metrics.busy_429.values.count : 0,
    servedRps: Number(
      (data.metrics.http_reqs.values.rate * (1 - data.metrics.http_req_failed.values.rate)).toFixed(
        1,
      ),
    ),
    servedP95Ms: Math.round(
      data.metrics['http_req_duration{expected_response:true}'].values['p(95)'],
    ),
    servedP99Ms: Math.round(
      data.metrics['http_req_duration{expected_response:true}'].values['p(99)'],
    ),
  };
  return {
    stdout: `${JSON.stringify(line)}\n`,
    [`/results/read-${__ENV.LABEL || RATE}.json`]: JSON.stringify(line),
  };
}
