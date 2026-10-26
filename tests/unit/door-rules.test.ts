import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ZXING_WASM_SHA256, ZXING_WASM_VERSION } from 'zxing-wasm/reader';
import { copyZxingWasm, installedZxing } from '../../scripts/vendor-wasm.mjs';
import { ZXING_WASM_URL } from '@/app/door/decoder';
import { inAppBrowser, isIos } from '@/app/door/platform';
import { DOOR_LIMITS, createDoorLimiter } from '@/lib/door-limits';
import { doorScansSchema } from '@/lib/validation/door';
import {
  doorWindow,
  formatPassCode,
  generatePassCode,
  normalisePassCode,
} from '@/server/lib/door-pass';
import { SCAN_INPUT_MAX } from '@/server/lib/door-rules';
import { parseScanToken, scanLogInput } from '@/server/lib/scan-token';

describe('parseScanToken', () => {
  it.each([
    ['TKT-4H8ZP2XQ', 'TKT-4H8ZP2XQ'],
    ['  tkt-4h8zp2xq \n', 'TKT-4H8ZP2XQ'],
    ['TKT 4H8Z P2XQ', 'TKT-4H8ZP2XQ'],
    ['4H8ZP2XQ', 'TKT-4H8ZP2XQ'],
    ['TKT4H8ZP2XQ', 'TKT-4H8ZP2XQ'],
    ['https://echoandaura.com/tickets/TKT-4H8ZP2XQ', 'TKT-4H8ZP2XQ'],
    ['https://echoandaura.com/tickets/tkt-4h8zp2xq?x=1', 'TKT-4H8ZP2XQ'],
  ])('reads %j as a ticket code', (raw, code) => {
    expect(parseScanToken(raw)).toBe(code);
  });

  it.each([
    [''],
    ['   '],
    ['TKT-4H8ZP2X'], // too short
    ['TKT-4H8ZP2XQQ'], // too long
    ['TKT-0O1IL000'], // letters outside the alphabet
    ['WIFI:S:Home;T:WPA;P:secret;;'],
    ['https://example.com/pay?code=TKT-4H8ZP2XQ'],
    ['A'.repeat(SCAN_INPUT_MAX + 1)],
  ])('refuses %j', (raw) => {
    expect(parseScanToken(raw)).toBeNull();
  });

  it('logs the code when it parsed, and only the length when it did not', () => {
    expect(scanLogInput('tkt-4h8zp2xq', 'TKT-4H8ZP2XQ')).toBe('TKT-4H8ZP2XQ');
    expect(scanLogInput('P:secret', null)).toBe('<unparsed:len=8>');
  });
});

describe('gate pass codes and window', () => {
  it('makes 12-symbol codes from the unambiguous alphabet, shown in groups of 4', () => {
    let i = 0;
    const code = generatePassCode(() => i++ % 5);
    expect(code).toMatch(/^[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{12}$/);
    expect(formatPassCode('K7QM4XPDR2TW')).toBe('K7QM-4XPD-R2TW');
  });

  it('accepts a code typed any way, and nothing else', () => {
    expect(normalisePassCode(' k7qm-4xpd r2tw ')).toBe('K7QM4XPDR2TW');
    expect(normalisePassCode('K7QM4XPDR2T')).toBeNull();
    expect(normalisePassCode('K7QM4XPDR2T0')).toBeNull(); // 0 is not in the alphabet
  });

  it('opens doors 4 h before the start and closes 6 h after the end (6 h default length)', () => {
    const startsAt = new Date('2026-10-01T13:00:00Z');
    expect(doorWindow({ startsAt, endsAt: null })).toEqual({
      validFrom: new Date('2026-10-01T09:00:00Z'),
      validUntil: new Date('2026-10-02T01:00:00Z'),
    });
    expect(doorWindow({ startsAt, endsAt: new Date('2026-10-01T16:00:00Z') }).validUntil).toEqual(
      new Date('2026-10-01T22:00:00Z'),
    );
  });
});

describe('door scan request', () => {
  const uuid = '00000000-0000-4000-a000-000000000001';

  it('takes exactly one scan carrying either input or a ticket id', () => {
    expect(
      doorScansSchema.safeParse({ scans: [{ scanId: uuid, input: 'x', method: 'qr' }] }).success,
    ).toBe(true);
    expect(
      doorScansSchema.safeParse({ scans: [{ scanId: uuid, ticketId: uuid, method: 'search' }] })
        .success,
    ).toBe(true);
    expect(
      doorScansSchema.safeParse({
        scans: [{ scanId: uuid, ticketId: uuid, method: 'search', phoneLast3: '678' }],
      }).success,
    ).toBe(true);
    for (const bad of [
      { scans: [] },
      {
        scans: [
          { scanId: uuid, input: 'x', method: 'qr' },
          { scanId: uuid, input: 'y', method: 'qr' },
        ],
      },
      { scans: [{ scanId: uuid, method: 'qr' }] },
      { scans: [{ scanId: uuid, input: 'x', ticketId: uuid, method: 'qr' }] },
      { scans: [{ scanId: uuid, input: 'x', method: 'search' }] },
      { scans: [{ scanId: uuid, ticketId: uuid, method: 'qr' }] },
      { scans: [{ scanId: 'not-a-uuid', input: 'x', method: 'qr' }] },
      // Phone digits: exactly 3, and only on a name-search admit.
      { scans: [{ scanId: uuid, ticketId: uuid, method: 'search', phoneLast3: '12' }] },
      { scans: [{ scanId: uuid, ticketId: uuid, method: 'search', phoneLast3: '12a' }] },
      { scans: [{ scanId: uuid, input: 'x', method: 'qr', phoneLast3: '123' }] },
      { scans: [{ scanId: uuid, input: 'A'.repeat(SCAN_INPUT_MAX + 1), method: 'qr' }] },
    ]) {
      expect(doorScansSchema.safeParse(bad).success).toBe(false);
    }
  });
});

describe('door rate limits', () => {
  it('fail open: a Redis outage never stops a gate', async () => {
    const down = () => Promise.reject(new Error('redis down'));
    const limiter = createDoorLimiter({ hit: down, peek: down });
    for (const rule of Object.values(DOOR_LIMITS)) {
      expect(await limiter.allow([{ ...rule, subject: 'pass-1' }])).toBe(true);
    }
  });

  it('keeps name-search admits tighter than scans', () => {
    expect(DOOR_LIMITS.searchAdmit.limit).toBeLessThan(DOOR_LIMITS.scan.limit);
  });
});

describe('door page platform checks', () => {
  it('spots in-app browsers and iPhones (including iPadOS posing as a Mac)', () => {
    expect(inAppBrowser('Mozilla/5.0 (iPhone) [FBAN/MessengerForiOS;FBAV/450.0]')).toBe('Facebook');
    expect(inAppBrowser('Mozilla/5.0 (Linux; Android 14) Instagram 330.0')).toBe('Instagram');
    expect(
      inAppBrowser('Mozilla/5.0 (Linux; Android 14) Chrome/140.0 Mobile Safari/537.36'),
    ).toBeNull();
    expect(isIos('Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)', 5)).toBe(true);
    expect(isIos('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)', 5)).toBe(true);
    expect(isIos('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)', 0)).toBe(false);
  });
});

describe('self-hosted QR decoder', () => {
  // The scanner runs the zxing-wasm that barcode-detector depends on (it pins
  // an exact version), not our own top-level entry. Ours exists so the test
  // below can read the checksum; the two must be the same version, or the
  // served .wasm would match one and be loaded by the other's glue code.
  // Upgrade both together, by hand (ADR-030); Dependabot ignores zxing-wasm.
  it('pins the same zxing-wasm that barcode-detector runs', () => {
    // Resolve the way the ponyfill does: from inside barcode-detector, through
    // exported entry points only (neither package exports package.json).
    const fromDetector = createRequire(require.resolve('barcode-detector/ponyfill'));
    // Walk up to the package root (dist/ folders carry their own stub
    // package.json with only a "type").
    const manifest = (dir: string): { name?: string; version?: string } =>
      existsSync(join(dir, 'package.json'))
        ? (JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8')) as { name?: string })
        : {};
    let dir = dirname(fromDetector.resolve('zxing-wasm/reader'));
    while (manifest(dir).name !== 'zxing-wasm' && dirname(dir) !== dir) dir = dirname(dir);
    expect(manifest(dir)).toMatchObject({ name: 'zxing-wasm', version: ZXING_WASM_VERSION });
  });

  // ADR-084: the build copies the .wasm out of node_modules (pnpm vendor:build).
  it('builds and serves exactly the .wasm the pinned zxing-wasm ships', async () => {
    const zxing = await installedZxing();
    expect(zxing).toMatchObject({ version: ZXING_WASM_VERSION, sha256: ZXING_WASM_SHA256 });
    const publicDir = mkdtempSync(join(tmpdir(), 'vendor-'));
    mkdirSync(join(publicDir, 'vendor'));
    writeFileSync(join(publicDir, 'vendor', 'zxing_reader-0.0.1.wasm'), 'old');
    expect(await copyZxingWasm(publicDir)).toBe(ZXING_WASM_URL);
    const file = readFileSync(join(publicDir, ZXING_WASM_URL));
    expect(createHash('sha256').update(file).digest('hex')).toBe(ZXING_WASM_SHA256);
    // An upgrade leaves no older decoder behind to be served.
    expect(readdirSync(join(publicDir, 'vendor'))).toEqual([
      ZXING_WASM_URL.slice('/vendor/'.length),
    ]);
  });

  it('every build and dev server copies the decoder first', () => {
    const { scripts } = JSON.parse(readFileSync('package.json', 'utf8')) as {
      scripts: Record<string, string>;
    };
    expect(scripts['vendor:build']).toBe('node scripts/vendor-wasm.mjs');
    expect(scripts.build).toMatch(/pnpm vendor:build && .*next build/);
    expect(scripts.dev).toMatch(/^pnpm vendor:build && next dev/);
  });

  it('refuses a .wasm whose hash is not the one the package publishes', async () => {
    const publicDir = mkdtempSync(join(tmpdir(), 'vendor-'));
    mkdirSync(join(publicDir, 'vendor'));
    writeFileSync(join(publicDir, ZXING_WASM_URL), 'served');
    const zxing = await installedZxing();
    await expect(copyZxingWasm(publicDir, { ...zxing, sha256: '0'.repeat(64) })).rejects.toThrow(
      'is not the file zxing-wasm',
    );
    await expect(copyZxingWasm(publicDir, { ...zxing, version: '' })).rejects.toThrow(
      'has no version',
    );
    // A refused copy leaves the file already served in place.
    expect(readFileSync(join(publicDir, ZXING_WASM_URL), 'utf8')).toBe('served');
  });
});
