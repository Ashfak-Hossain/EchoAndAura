import { describe, expect, it } from 'vitest';
import { CLOUDFLARE_RANGES, clientIpFromForwardedFor } from '@/lib/client-ip';

// A Cloudflare edge address, as Traefik appends it (seen in production).
const EDGE = '172.68.132.140';
const VISITOR = '45.248.151.54';

describe('clientIpFromForwardedFor (ADR-037)', () => {
  // The three headers the whoami test printed on 2026-09-28, verbatim.
  it('a normal visit through Cloudflare → the visitor', () => {
    expect(clientIpFromForwardedFor(`${VISITOR}, ${EDGE}`)).toBe(VISITOR);
  });

  it('a faked X-Forwarded-For through Cloudflare → still the visitor, never the fake', () => {
    expect(clientIpFromForwardedFor(`1.2.3.4,${VISITOR}, ${EDGE}`)).toBe(VISITOR);
  });

  it('a request that skipped Cloudflare (Traefik replaced the header) → the sender', () => {
    expect(clientIpFromForwardedFor('59.153.100.215')).toBe('59.153.100.215');
  });

  it('ignores any number of fakes, including a fake Cloudflare address', () => {
    expect(clientIpFromForwardedFor(`9.9.9.9, 8.8.8.8, ${VISITOR}, ${EDGE}`)).toBe(VISITOR);
    expect(clientIpFromForwardedFor(`104.16.0.1, ${VISITOR}, ${EDGE}`)).toBe(VISITOR);
  });

  it('ignores garbage to the left of the visitor', () => {
    expect(clientIpFromForwardedFor(`<script>, not-an-ip, ${VISITOR}, ${EDGE}`)).toBe(VISITOR);
  });

  it('keys an IPv6 visitor by its /64, so one device cannot rotate past a limit', () => {
    const a = clientIpFromForwardedFor('2001:db8:abcd:12:1:2:3:4, 2606:4700:10::ac43:1');
    const b = clientIpFromForwardedFor('2001:db8:abcd:12:ffff::9, 2606:4700:10::ac43:1');
    expect(a).toBe('2001:db8:abcd:12::/64');
    expect(b).toBe(a);
    expect(clientIpFromForwardedFor('2001:db8:abcd:13::1')).not.toBe(a);
  });

  it('normalises IPv6 spelling: compressed, leading zeros, capitals', () => {
    expect(clientIpFromForwardedFor('2001:db8::1')).toBe('2001:db8:0:0::/64');
    expect(clientIpFromForwardedFor('2001:0DB8:0000:0012::5')).toBe('2001:db8:0:12::/64');
  });

  it('treats an IPv4 address written as IPv6 as the IPv4 visitor', () => {
    expect(clientIpFromForwardedFor(`::ffff:${VISITOR}, ${EDGE}`)).toBe(VISITOR);
  });

  it('local dev and e2e (no proxy) share one bucket', () => {
    expect(clientIpFromForwardedFor('::1')).toBe('0:0:0:0::/64');
    expect(clientIpFromForwardedFor('127.0.0.1')).toBe('127.0.0.1');
  });

  describe('no usable address → null (the caller falls back to one shared bucket)', () => {
    it.each([
      ['no header', undefined],
      ['null', null],
      ['empty', ''],
      ['only separators', ' , ,'],
      ['only Cloudflare addresses', `${EDGE}, 2606:4700::1`],
      ['garbage where the visitor should be', `not-an-ip, ${EDGE}`],
    ])('%s', (_label, header) => {
      expect(clientIpFromForwardedFor(header)).toBeNull();
    });
  });

  it('every published range is loaded (one address from each family is trusted)', () => {
    expect(CLOUDFLARE_RANGES).toHaveLength(22);
    expect(clientIpFromForwardedFor(`${VISITOR}, 104.16.0.1`)).toBe(VISITOR);
    expect(clientIpFromForwardedFor(`${VISITOR}, 2c0f:f248::1`)).toBe(VISITOR);
  });
});
