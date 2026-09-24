'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { type QrDetector, loadQrDetector } from './decoder';

/**
 * The door camera: rear camera, a QR decode loop, the wake lock, the torch.
 *
 * `start()` must run inside a tap — the wake lock (and, on iOS, the camera
 * prompt) need a user gesture. When the page is hidden (the phone locks,
 * another app opens) everything is released; the screen then shows "Tap to
 * resume", because only a tap may take them back. The loop decodes at most
 * ~10 frames a second, one at a time, and pauses itself after 2 minutes
 * with nothing in view, to save the battery on a long night.
 */

export type CameraProblem = 'denied' | 'busy' | 'none' | 'insecure' | 'decoder';
export type CameraState =
  | { kind: 'off' }
  | { kind: 'starting' }
  | { kind: 'on' }
  | { kind: 'paused'; why: 'hidden' | 'idle' | 'ended' }
  | { kind: 'error'; problem: CameraProblem };

const DETECT_EVERY_MS = 100;
/** No frame for this long while "on" (a call banner, Siri, a muted track): treat it as lost. */
const STALL_MS = 3_000;
export const CAMERA_IDLE_MS = 2 * 60_000;
const CAMERA_KEY = 'door:camera';

type TorchCapabilities = MediaTrackCapabilities & { torch?: boolean };
type TorchConstraint = MediaTrackConstraintSet & { torch?: boolean };

function problemOf(err: unknown): CameraProblem {
  const name = err instanceof Error || err instanceof DOMException ? err.name : '';
  if (name === 'NotAllowedError' || name === 'SecurityError') return 'denied';
  if (name === 'NotReadableError' || name === 'AbortError') return 'busy';
  return 'none';
}

function savedCamera(): string | null {
  try {
    return localStorage.getItem(CAMERA_KEY);
  } catch {
    return null;
  }
}

function saveCamera(id: string | undefined): void {
  if (!id) return;
  try {
    localStorage.setItem(CAMERA_KEY, id);
  } catch {
    // Private mode: the rear camera is picked again next time.
  }
}

async function openStream(deviceId: string | null): Promise<MediaStream> {
  const size = { width: { ideal: 1280 }, height: { ideal: 720 } };
  if (deviceId) {
    try {
      return await navigator.mediaDevices.getUserMedia({
        audio: false,
        video: { deviceId: { exact: deviceId }, ...size },
      });
    } catch (err: unknown) {
      // The remembered camera is gone (ids rotate): fall back to the rear one.
      if (problemOf(err) !== 'none') throw err;
    }
  }
  return navigator.mediaDevices.getUserMedia({
    audio: false,
    video: { facingMode: { ideal: 'environment' }, ...size },
  });
}

async function requestWakeLock(): Promise<WakeLockSentinel | null> {
  if (!('wakeLock' in navigator)) return null;
  try {
    return await navigator.wakeLock.request('screen');
  } catch {
    return null;
  }
}

/** Attach the returned `video` ref to the page's `<video muted playsInline>`. */
export function useCamera(onCode: (text: string) => void) {
  const video = useRef<HTMLVideoElement | null>(null);
  const [state, setState] = useState<CameraState>({ kind: 'off' });
  const [torch, setTorch] = useState({ available: false, on: false });
  const [cameras, setCameras] = useState(0);
  /** Null until started; false = asked for, refused (the screen may sleep). */
  const [awake, setAwake] = useState<boolean | null>(null);

  const stream = useRef<MediaStream | null>(null);
  const wake = useRef<WakeLockSentinel | null>(null);
  /** Bumped on every stop: a running loop or a late promise sees it and quits. */
  const generation = useRef(0);
  const lastSeen = useRef(0);
  const onCodeRef = useRef(onCode);
  useEffect(() => {
    onCodeRef.current = onCode;
  });

  const release = useCallback(() => {
    generation.current++;
    for (const track of stream.current?.getTracks() ?? []) {
      track.onended = null;
      track.stop();
    }
    stream.current = null;
    if (video.current) video.current.srcObject = null;
    const lock = wake.current;
    wake.current = null;
    if (lock) {
      lock.onrelease = null;
      void lock.release().catch(() => {});
    }
    setTorch({ available: false, on: false });
  }, []);

  const pause = useCallback(
    (why: 'hidden' | 'idle' | 'ended') => {
      release();
      setState({ kind: 'paused', why });
    },
    [release],
  );

  const loop = useCallback(
    (gen: number, el: HTMLVideoElement, detector: QrDetector) => {
      let busy = false;
      let last = 0;
      let lastFrame = performance.now();
      // Frames drive the loop, so a camera that stops producing them would
      // stop every check with it — including this one, hence an interval.
      const health = setInterval(() => {
        if (generation.current !== gen) return clearInterval(health);
        if (performance.now() - lastFrame > STALL_MS) {
          clearInterval(health);
          pause('ended');
        }
      }, 1_000);
      const next = () => {
        if (generation.current !== gen) return;
        if ('requestVideoFrameCallback' in el) el.requestVideoFrameCallback(tick);
        else requestAnimationFrame(tick);
      };
      const tick = () => {
        if (generation.current !== gen) return;
        const now = performance.now();
        lastFrame = now;
        if (now - lastSeen.current > CAMERA_IDLE_MS) {
          pause('idle');
          return;
        }
        if (!busy && now - last >= DETECT_EVERY_MS && el.readyState >= 2) {
          busy = true;
          last = now;
          detector
            .detect(el)
            .then((codes) => {
              if (generation.current !== gen) return;
              for (const code of codes) {
                if (!code.rawValue) continue;
                lastSeen.current = performance.now();
                onCodeRef.current(code.rawValue);
              }
            })
            .catch(() => {})
            .finally(() => {
              busy = false;
            });
        }
        next();
      };
      next();
    },
    [pause],
  );

  /** Call from inside a tap. `deviceId` switches camera. */
  const start = useCallback(
    async (deviceId?: string) => {
      if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia) {
        setState({ kind: 'error', problem: 'insecure' });
        return;
      }
      release();
      const gen = generation.current;
      // Asked for first, while the tap still counts as a user gesture.
      const lockPromise = requestWakeLock();
      const detectorPromise = loadQrDetector();
      setState({ kind: 'starting' });

      let opened: MediaStream;
      try {
        opened = await openStream(deviceId ?? savedCamera());
      } catch (err: unknown) {
        void lockPromise.then((l) => l?.release());
        if (generation.current === gen) setState({ kind: 'error', problem: problemOf(err) });
        return;
      }
      if (generation.current !== gen) {
        for (const t of opened.getTracks()) t.stop();
        return;
      }
      stream.current = opened;
      const track = opened.getVideoTracks()[0];
      if (track) {
        track.onended = () => {
          if (generation.current === gen) pause('ended');
        };
        saveCamera(track.getSettings().deviceId);
        const caps: TorchCapabilities = track.getCapabilities?.() ?? {};
        setTorch({ available: caps.torch === true, on: false });
      }
      const el = video.current;
      if (el) {
        el.srcObject = opened;
        await el.play().catch(() => {});
      }
      void navigator.mediaDevices
        .enumerateDevices()
        .then((all) => setCameras(all.filter((d) => d.kind === 'videoinput').length))
        .catch(() => {});

      const lock = await lockPromise;
      if (generation.current !== gen) {
        void lock?.release();
        return;
      }
      wake.current = lock;
      setAwake(lock !== null);
      if (lock) {
        lock.onrelease = () => {
          if (wake.current === lock) {
            wake.current = null;
            setAwake(false);
          }
        };
      }

      let detector: QrDetector;
      try {
        detector = await detectorPromise;
      } catch {
        if (generation.current === gen) {
          release();
          setState({ kind: 'error', problem: 'decoder' });
        }
        return;
      }
      if (generation.current !== gen || !el) return;
      lastSeen.current = performance.now();
      setState({ kind: 'on' });
      loop(gen, el, detector);
    },
    [loop, pause, release],
  );

  /** Next camera in the list (a phone with several rear lenses). */
  const switchCamera = useCallback(async () => {
    const current = stream.current?.getVideoTracks()[0]?.getSettings().deviceId;
    const all = (await navigator.mediaDevices.enumerateDevices()).filter(
      (d) => d.kind === 'videoinput',
    );
    if (all.length < 2) return;
    const at = all.findIndex((d) => d.deviceId === current);
    await start(all[(at + 1) % all.length]!.deviceId);
  }, [start]);

  const toggleTorch = useCallback(async () => {
    const track = stream.current?.getVideoTracks()[0];
    if (!track) return;
    const on = !torch.on;
    const advanced: TorchConstraint[] = [{ torch: on }];
    try {
      await track.applyConstraints({ advanced });
      setTorch({ available: true, on });
    } catch {
      setTorch({ available: false, on: false });
    }
  }, [torch.on]);

  /** A typed or searched admit counts as activity: don't idle-pause mid-rush. */
  const touch = useCallback(() => {
    lastSeen.current = performance.now();
  }, []);

  useEffect(() => {
    const onVisibility = () => {
      if (document.visibilityState === 'hidden' && stream.current) pause('hidden');
    };
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      document.removeEventListener('visibilitychange', onVisibility);
      release();
    };
  }, [pause, release]);

  return { video, state, torch, cameras, awake, start, switchCamera, toggleTorch, touch };
}
