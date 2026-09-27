import { BlockList, isIP } from 'node:net';

/**
 * ADR-037: Cloudflare's published edge ranges (https://www.cloudflare.com/ips/),
 * fetched 2026-09-28. The same list is in the server's Traefik config
 * (`/etc/dokploy/traefik/traefik.yml`, docs/infra/SERVER.md § 13): change
 * both together, or Traefik and the app disagree about who the visitor is.
 */
export const CLOUDFLARE_RANGES = [
  '173.245.48.0/20',
  '103.21.244.0/22',
  '103.22.200.0/22',
  '103.31.4.0/22',
  '141.101.64.0/18',
  '108.162.192.0/18',
  '190.93.240.0/20',
  '188.114.96.0/20',
  '197.234.240.0/22',
  '198.41.128.0/17',
  '162.158.0.0/15',
  '104.16.0.0/13',
  '104.24.0.0/14',
  '172.64.0.0/13',
  '131.0.72.0/22',
  '2400:cb00::/32',
  '2606:4700::/32',
  '2803:f800::/32',
  '2405:b500::/32',
  '2405:8100::/32',
  '2a06:98c0::/29',
  '2c0f:f248::/32',
] as const;

const trustedProxies = new BlockList();
for (const range of CLOUDFLARE_RANGES) {
  const [network = '', bits = ''] = range.split('/');
  trustedProxies.addSubnet(network, Number(bits), network.includes(':') ? 'ipv6' : 'ipv4');
}

/**
 * The visitor's address in `X-Forwarded-For`, for rate-limit keys (ADR-037).
 *
 * Every proxy appends the address it received the request from, so the
 * list reads visitor → Cloudflare → (Traefik appends Cloudflare's edge).
 * The left end is whatever the visitor sent, which is why it can't be
 * trusted: through Cloudflare, `X-Forwarded-For: 1.2.3.4` arrives as
 * `1.2.3.4, <visitor>, <edge>`. Walking from the right and skipping
 * Cloudflare's addresses lands on the address Cloudflare itself saw.
 * A request that skips Cloudflare has its header replaced by Traefik with
 * the real sender, which then is the only entry.
 *
 * IPv6 visitors are keyed by their /64: a home or phone connection gets a
 * whole /64, so one address each would let a single device rotate past
 * every limit.
 *
 * @returns null when there is no usable address (no header, an invalid
 *   entry where the visitor should be, or only Cloudflare addresses).
 */
export function clientIpFromForwardedFor(header: string | null | undefined): string | null {
  if (!header) return null;
  const hops = header
    .split(',')
    .map((hop) => hop.trim())
    .filter(Boolean);
  for (let i = hops.length - 1; i >= 0; i--) {
    const ip = unmapIPv4(hops[i] ?? '');
    const version = isIP(ip);
    if (version === 0) return null;
    if (trustedProxies.check(ip, version === 6 ? 'ipv6' : 'ipv4')) continue;
    return version === 6 ? ipv6Prefix64(ip) : ip;
  }
  return null;
}

/** `::ffff:192.0.2.1` is an IPv4 visitor written as IPv6. */
function unmapIPv4(ip: string): string {
  const lower = ip.toLowerCase();
  if (lower.startsWith('::ffff:') && isIP(lower.slice(7)) === 4) return lower.slice(7);
  return lower;
}

/** `2001:DB8:0:12:…` → `2001:db8:0:12::/64`. */
function ipv6Prefix64(ip: string): string {
  const [head = '', tail] = ip.split('::');
  const left = head ? head.split(':') : [];
  const right = tail ? tail.split(':') : [];
  // A trailing dotted IPv4 part (`::ffff:0:1.2.3.4`) fills two groups.
  const width = (groups: string[]) => groups.reduce((n, g) => n + (g.includes('.') ? 2 : 1), 0);
  const groups =
    tail === undefined
      ? left
      : [...left, ...Array<string>(8 - width(left) - width(right)).fill('0'), ...right];
  const prefix = groups.slice(0, 4).map((g) => g.replace(/^0+(?=.)/, ''));
  return `${prefix.join(':')}::/64`;
}
