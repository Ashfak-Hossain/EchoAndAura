// Phase 7.5 (docs/LOAD-TEST.md): BUYERS people try to register for the load
// event's SEATS seats at the same moment — the on-sale rush. Exactly SEATS
// must get a hold, everyone else a clean "sold out", nobody an error; then
// ops/load/check.sql proves the database agrees (no oversell).
//
//   docker compose -f ops/load/docker-compose.yml run --rm k6 run /scripts/register.js
//
// Each buyer submits the real form the way a browser without JavaScript
// does: load the page, copy the form's hidden `$ACTION_*` fields (React's
// reference to the bound server action), add the buyer's answers, POST it
// as multipart with a same-origin Origin header (Next's CSRF check).
import http from 'k6/http';
import { check } from 'k6';
import { Counter } from 'k6/metrics';
import { parseHTML } from 'k6/html';

const BASE = __ENV.BASE_URL || 'http://web:3000';
const EVENT = __ENV.EVENT_SLUG || 'load-test-night';
const BUYERS = Number(__ENV.BUYERS || 200);
const SEATS = Number(__ENV.SEATS || 100);
const FORM_URL = `${BASE}/events/${EVENT}/register`;

const held = new Counter('orders_held');
const soldOut = new Counter('told_sold_out');
const errors = new Counter('unexpected_answers');
// Through Traefik's in-flight cap (--profile shed, Phase 7.6): "busy, try
// again" at once. Counted apart: a designed answer, not a broken one.
const busy = new Counter('busy_429');

export const options = {
  scenarios: {
    rush: {
      executor: 'per-vu-iterations',
      vus: BUYERS,
      iterations: 1,
      maxDuration: '3m',
    },
  },
  summaryTrendStats: ['med', 'p(95)', 'p(99)', 'max'],
  thresholds: {
    orders_held: [`count==${SEATS}`],
    unexpected_answers: ['count==0'],
    'http_req_duration{step:submit}': ['p(95)<2000'],
  },
};

function multipart(fields) {
  const boundary = `----k6load${Math.random().toString(16).slice(2)}`;
  let body = '';
  for (const [name, value] of fields) {
    body += `--${boundary}\r\nContent-Disposition: form-data; name="${name}"\r\n\r\n${value}\r\n`;
  }
  body += `--${boundary}--\r\n`;
  return { body, contentType: `multipart/form-data; boundary=${boundary}` };
}

export default function buyer() {
  const page = http.get(FORM_URL, { tags: { step: 'form' } });
  if (page.status === 429) {
    busy.add(1);
    return;
  }
  if (!check(page, { 'form 200': (r) => r.status === 200 })) {
    errors.add(1);
    return;
  }
  const form = parseHTML(page.body).find('form:has(input[name=buyerName])');
  const fields = [];
  form.find('input[type=hidden]').each((_, el) => {
    const name = el.getAttribute('name') || '';
    if (name.startsWith('$ACTION')) fields.push([name, el.getAttribute('value') || '']);
  });
  const ticketTypeId = form.find('input[name=ticketTypeId]').first().attr('value');

  const vu = __VU;
  fields.push(
    ['ticketTypeId', ticketTypeId],
    ['quantity', '1'],
    ['buyerName', `Load Buyer ${vu}`],
    ['buyerEmail', `load.buyer.${vu}@example.com`],
    ['buyerPhone', `17${String(10_000_000 + vu).slice(-8)}`],
    ['terms', 'on'],
  );
  const { body, contentType } = multipart(fields);
  const res = http.post(FORM_URL, body, {
    // A distinct address per buyer: the app allows 20 new orders per IP per
    // 15 minutes (Phase 7.6), and a real rush comes from many networks.
    // With no proxy in front, the app reads this header as the visitor.
    headers: {
      'Content-Type': contentType,
      Origin: BASE,
      'X-Forwarded-For': `198.18.${Math.floor(vu / 250)}.${(vu % 250) + 1}`,
    },
    redirects: 0,
    tags: { step: 'submit' },
  });

  const location = res.headers.Location || res.headers.location || '';
  if (res.status === 303 && location.includes('/orders/')) {
    held.add(1);
  } else if (res.status === 200 && /sold out/i.test(res.body)) {
    soldOut.add(1);
  } else if (res.status === 429) {
    busy.add(1);
  } else {
    errors.add(1);
    console.warn(`buyer ${vu}: HTTP ${res.status} ${location} ${String(res.body).slice(0, 200)}`);
  }
}

export function handleSummary(data) {
  const count = (name) => (data.metrics[name] ? data.metrics[name].values.count : 0);
  const submit = data.metrics['http_req_duration{step:submit}'];
  const line = {
    buyers: BUYERS,
    seats: SEATS,
    held: count('orders_held'),
    soldOut: count('told_sold_out'),
    unexpected: count('unexpected_answers'),
    busy429: count('busy_429'),
    submitMedMs: submit ? Math.round(submit.values.med) : null,
    submitP95Ms: submit ? Math.round(submit.values['p(95)']) : null,
    submitMaxMs: submit ? Math.round(submit.values.max) : null,
    durationS: Math.round(data.state.testRunDurationMs / 1000),
  };
  return {
    stdout: `${JSON.stringify(line)}\n`,
    '/results/register.json': JSON.stringify(line),
  };
}
