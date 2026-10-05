import { describe, expect, it } from 'vitest';
import { type SelfTestInput, selfTestRows } from '@/app/door/self-test';

const NOW = Date.parse('2026-10-10T12:40:00Z'); // 6:40 PM in Dhaka

const good: SelfTestInput = {
  camera: { kind: 'on' },
  lens: { facing: 'back', focused: true },
  readMs: 80,
  decoder: 'native',
  list: { ready: true, size: 450, listAt: '2026-10-10T12:38:00Z' },
  now: NOW,
  sound: 'heard',
  battery: { level: 0.82, charging: false },
  saved: 'saved',
};

const row = (input: Partial<SelfTestInput>, key: string) =>
  selfTestRows({ ...good, ...input }).rows.find((r) => r.key === key);

describe('the pre-doors test', () => {
  it('a phone with everything working is READY', () => {
    const t = selfTestRows(good);
    expect(t.ready).toBe(true);
    expect(t.left).toBe(0);
    expect(t.rows.map((r) => r.value)).toEqual([
      'Back camera · focused',
      '0.08 s per read · phone reader',
      '450 tickets · 6:38 PM',
      'Heard',
      '82 %',
      'Page and list saved on phone',
    ]);
  });

  it('is not READY until sound is heard — playing it is not enough', () => {
    expect(selfTestRows({ ...good, sound: 'untested' })).toMatchObject({ ready: false, left: 1 });
    expect(row({ sound: 'played' }, 'sound')).toMatchObject({ level: 'warn' });
  });

  it('the camera: starting waits, a problem fails with its reason, the front camera warns', () => {
    expect(row({ camera: { kind: 'starting' } }, 'camera')?.level).toBe('wait');
    expect(row({ camera: { kind: 'error', problem: 'denied' } }, 'camera')).toMatchObject({
      level: 'fail',
      value: expect.stringMatching(/blocked/),
    });
    expect(row({ camera: { kind: 'error', problem: 'busy' } }, 'speed')?.level).toBe('fail');
    expect(row({ lens: { facing: 'front', focused: false } }, 'camera')).toMatchObject({
      level: 'warn',
      value: 'Front camera',
    });
    expect(row({ lens: { facing: null, focused: false } }, 'camera')).toMatchObject({
      level: 'ok',
      value: 'On',
    });
  });

  it('reading speed: measuring, then ok under 150 ms, slow to 400 ms, too slow past it', () => {
    expect(row({ readMs: null }, 'speed')?.level).toBe('wait');
    expect(row({ readMs: 149 }, 'speed')?.level).toBe('ok');
    expect(row({ readMs: 150 }, 'speed')?.level).toBe('warn');
    expect(row({ readMs: 400 }, 'speed')?.level).toBe('warn');
    expect(row({ readMs: 401, decoder: 'zxing' }, 'speed')).toMatchObject({
      level: 'fail',
      value: expect.stringMatching(/^0\.40 s per read · web reader · too slow/),
    });
  });

  it('the ticket list: none fails, older than 5 minutes warns', () => {
    expect(row({ list: { ready: false, size: 0, listAt: null } }, 'list')?.level).toBe('fail');
    expect(row({ list: { ...good.list, listAt: '2026-10-10T12:35:00Z' } }, 'list')?.level).toBe(
      'ok',
    );
    expect(row({ list: { ...good.list, listAt: '2026-10-10T12:34:59Z' } }, 'list')?.level).toBe(
      'warn',
    );
  });

  it('battery: left out where the phone does not say; charging is fine at any level', () => {
    expect(row({ battery: null }, 'battery')).toBeUndefined();
    expect(selfTestRows({ ...good, battery: null }).ready).toBe(true);
    expect(row({ battery: { level: 0.1, charging: true } }, 'battery')?.level).toBe('ok');
    expect(row({ battery: { level: 0.5, charging: false } }, 'battery')?.level).toBe('ok');
    expect(row({ battery: { level: 0.49, charging: false } }, 'battery')?.level).toBe('warn');
    expect(row({ battery: { level: 0.19, charging: false } }, 'battery')?.level).toBe('fail');
  });

  it('works offline only with the page saved and a list', () => {
    expect(row({ saved: 'saving' }, 'offline')?.level).toBe('wait');
    expect(row({ saved: 'failed' }, 'offline')?.level).toBe('fail');
    expect(row({ saved: 'unsupported' }, 'offline')?.level).toBe('fail');
    expect(row({ list: { ready: false, size: 0, listAt: null } }, 'offline')?.level).toBe('fail');
  });

  it('counts every check not passed, waits included', () => {
    expect(selfTestRows({ ...good, readMs: null, sound: 'untested', saved: 'failed' }).left).toBe(
      3,
    );
  });
});
