import { formatDhakaClock } from '@/lib/time';
import type { CameraProblem, CameraState } from './use-camera';

/**
 * ADR-059: the pre-doors test. Each gate phone checks, before doors open,
 * the things that otherwise fail in front of the queue: the camera, how
 * fast it reads, the ticket list, sound, battery, the offline copy.
 * Pure: the screen renders what this returns. Never a gate on scanning —
 * a phone that fails a check can still scan; the gate decides.
 */

export type CheckLevel = 'ok' | 'warn' | 'fail' | 'wait';

export interface SelfTestRow {
  key: 'camera' | 'speed' | 'list' | 'sound' | 'battery' | 'offline';
  label: string;
  value: string;
  level: CheckLevel;
}

export interface SelfTestInput {
  camera: CameraState;
  lens: { facing: 'back' | 'front' | null; focused: boolean };
  readMs: number | null;
  decoder: 'native' | 'zxing' | null;
  list: { ready: boolean; size: number; listAt: string | null };
  /** The phone's clock corrected to the server's (ms). */
  now: number;
  sound: 'untested' | 'played' | 'heard';
  /** Null where the browser does not report it (iPhone): the row is left out. */
  battery: { level: number; charging: boolean } | null;
  /** The page and its decoders saved for a reload without signal. */
  saved: 'saving' | 'saved' | 'failed' | 'unsupported';
}

/** Measured on the Mac: 4–17 ms (ADR-052). A phone at 150 ms still reads ~6 times a second. */
export const SPEED_OK_MS = 150;
/** Slower than this, a code held up waits visibly for the answer. */
export const SPEED_FAIL_MS = 400;
/** The list refreshes every minute while online; older means the refresh is failing. */
export const LIST_FRESH_MS = 5 * 60_000;
export const BATTERY_OK = 0.5;
export const BATTERY_FAIL = 0.2;

const PROBLEM_TEXT: Record<CameraProblem, string> = {
  denied: 'Camera blocked — allow it in the browser',
  busy: 'Another app is using the camera',
  none: 'No camera found',
  insecure: 'Camera needs the secure site (https)',
  decoder: 'The code reader did not load',
};

function cameraRow({ camera, lens }: SelfTestInput): SelfTestRow {
  const base = { key: 'camera', label: 'Camera' } as const;
  if (camera.kind === 'error')
    return { ...base, value: PROBLEM_TEXT[camera.problem], level: 'fail' };
  if (camera.kind !== 'on') return { ...base, value: 'Starting…', level: 'wait' };
  const side =
    lens.facing === 'front' ? 'Front camera' : lens.facing === 'back' ? 'Back camera' : 'On';
  // The front camera reads too, but staff then hold the phone the wrong way round.
  return {
    ...base,
    value: `${side}${lens.focused ? ' · focused' : ''}`,
    level: lens.facing === 'front' ? 'warn' : 'ok',
  };
}

function speedRow({ camera, readMs, decoder }: SelfTestInput): SelfTestRow {
  const base = { key: 'speed', label: 'Reading speed' } as const;
  if (camera.kind === 'error') return { ...base, value: 'No camera', level: 'fail' };
  if (readMs === null) return { ...base, value: 'Measuring…', level: 'wait' };
  const reader = decoder === 'native' ? 'phone reader' : 'web reader';
  const value = `${(readMs / 1000).toFixed(2)} s per read · ${reader}`;
  if (readMs < SPEED_OK_MS) return { ...base, value, level: 'ok' };
  if (readMs <= SPEED_FAIL_MS)
    return { ...base, value: `${value} · slow, close other apps`, level: 'warn' };
  return { ...base, value: `${value} · too slow, use another phone`, level: 'fail' };
}

function listRow({ list, now }: SelfTestInput): SelfTestRow {
  const base = { key: 'list', label: 'Ticket list fresh' } as const;
  if (!list.ready || !list.listAt)
    return { ...base, value: 'No list on this phone yet', level: 'fail' };
  const at = new Date(list.listAt);
  const value = `${list.size} tickets · ${formatDhakaClock(at)}`;
  return now - at.getTime() <= LIST_FRESH_MS
    ? { ...base, value, level: 'ok' }
    : { ...base, value: `${value} · old, check the signal`, level: 'warn' };
}

function soundRow({ sound }: SelfTestInput): SelfTestRow {
  const base = { key: 'sound', label: 'Sound and vibration' } as const;
  if (sound === 'heard') return { ...base, value: 'Heard', level: 'ok' };
  return {
    ...base,
    value: sound === 'played' ? 'Did you hear it? Volume up, silent off' : 'Not tested yet',
    level: 'warn',
  };
}

function batteryRow({ battery }: SelfTestInput): SelfTestRow | null {
  if (!battery) return null;
  const base = { key: 'battery', label: 'Battery' } as const;
  const pct = `${Math.round(battery.level * 100)} %`;
  if (battery.charging) return { ...base, value: `${pct} · charging`, level: 'ok' };
  if (battery.level >= BATTERY_OK) return { ...base, value: pct, level: 'ok' };
  if (battery.level >= BATTERY_FAIL) {
    return { ...base, value: `${pct} · plug in a power bank`, level: 'warn' };
  }
  return { ...base, value: `${pct} · charge now`, level: 'fail' };
}

function offlineRow({ saved, list }: SelfTestInput): SelfTestRow {
  const base = { key: 'offline', label: 'Works offline' } as const;
  if (saved === 'unsupported') {
    return {
      ...base,
      value: 'This browser cannot keep the page — use Chrome or Safari',
      level: 'fail',
    };
  }
  if (saved === 'failed')
    return { ...base, value: 'Could not save — reload the page', level: 'fail' };
  if (saved === 'saving') return { ...base, value: 'Saving…', level: 'wait' };
  if (!list.ready) return { ...base, value: 'Page saved, no list yet', level: 'fail' };
  return { ...base, value: 'Page and list saved on phone', level: 'ok' };
}

export function selfTestRows(input: SelfTestInput): {
  rows: SelfTestRow[];
  /** Every check passed: the READY card. */
  ready: boolean;
  /** Checks not passed yet. */
  left: number;
} {
  const rows = [
    cameraRow(input),
    speedRow(input),
    listRow(input),
    soundRow(input),
    batteryRow(input),
    offlineRow(input),
  ].filter((r): r is SelfTestRow => r !== null);
  const left = rows.filter((r) => r.level !== 'ok').length;
  return { rows, ready: left === 0, left };
}
