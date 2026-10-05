'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  type QrDetector,
  type QrSource,
  centreCrop,
  loadFallbackDecoder,
  loadQrDetector,
} from './decoder';

/**
 * The door camera: rear camera, a QR decode loop, the wake lock, the torch.
 *
 * `start()` must run inside a tap — the wake lock (and, on iOS, the camera
 * prompt) need a user gesture. When the page is hidden (the phone locks,
 * another app opens) everything is released; the screen then shows "Tap to
 * resume", because only a tap may take them back. The loop decodes at most
 * ~16 frames a second, one at a time, and pauses itself after 2 minutes
 * with nothing in view, to save the battery on a long night.
 *
 * The WebAssembly decoder reads only the centre of the frame, scaled down
 * (`centreCrop`), with a full frame every few reads for a code held off to
 * the side; the browser's own reader (Android) gets the full frame. Each
 * read is timed: `readMs` is the running average, for the pre-doors test.
 */

export type CameraProblem = 'denied' | 'busy' | 'none' | 'insecure' | 'decoder';
export type CameraState =
  | { kind: 'off' }
  | { kind: 'starting' }
  | { kind: 'on' }
  | { kind: 'paused'; why: 'hidden' | 'idle' | 'ended' }
  | { kind: 'error'; problem: CameraProblem };

const DETECT_EVERY_MS = 60;
/** Every Nth WebAssembly read is the full frame, so an off-centre code is still found. */
const FULL_FRAME_EVERY = 5;
/** Reads left out of the running average: the first ones carry one-off start-up costs. */
const WARM_READS = 3;
/** Failed reads in a row before the phone's own reader is swapped for WebAssembly. */
const NATIVE_FAILURES_MAX = 5;
/** The longest Start waits for the decoder's warm-up read before it opens anyway. */
const WARM_UP_MAX_MS = 3_000;

/**
 * One throw-away read on a blank image, so the first person in the queue
 * does not pay for the decoder loading its model (about 1.5 s for Chrome's
 * own reader, measured) — never more than WARM_UP_MAX_MS.
 */
async function warmUp(detector: QrDetector): Promise<void> {
  if (typeof ImageData === 'undefined') return;
  await Promise.race([
    detector.detect(new ImageData(16, 16)).catch(() => []),
    new Promise((resolve) => setTimeout(resolve, WARM_UP_MAX_MS)),
  ]);
}
/** No frame for this long while "on" (a call banner, Siri, a muted track): treat it as lost. */
const STALL_MS = 3_000;
export const CAMERA_IDLE_MS = 2 * 60_000;
const CAMERA_KEY = 'door:camera';

type TorchCapabilities = MediaTrackCapabilities & { torch?: boolean };
type TorchConstraint = MediaTrackConstraintSet & { torch?: boolean };
type CameraCapabilities = TorchCapabilities & {
  zoom?: { min: number; max: number };
  focusMode?: string[];
};
type CameraConstraint = TorchConstraint & { zoom?: number; focusMode?: string };

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
  /** 2x is offered when the camera can zoom that far (Android Chrome; not iOS Safari). */
  const [zoom, setZoom] = useState({ available: false, level: 1 });
  /** Running average of one decode, in ms; null until the first reads. */
  const [readMs, setReadMs] = useState<number | null>(null);
  /** Which reader runs: the browser's own, or the WebAssembly fallback. */
  const [decoder, setDecoder] = useState<QrDetector['kind'] | null>(null);
  /** For the pre-doors test: which way the camera faces, and whether it keeps refocusing. */
  const [lens, setLens] = useState<{ facing: 'back' | 'front' | null; focused: boolean }>({
    facing: null,
    focused: false,
  });
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
    setZoom({ available: false, level: 1 });
  }, []);

  const pause = useCallback(
    (why: 'hidden' | 'idle' | 'ended') => {
      release();
      setState({ kind: 'paused', why });
    },
    [release],
  );

  const loop = useCallback(
    (gen: number, el: HTMLVideoElement, first: QrDetector) => {
      let detector = first;
      let failures = 0;
      let busy = false;
      let last = 0;
      let lastFrame = performance.now();
      let reads = 0;
      let average: number | null = null;
      let shownAt = 0;
      // One reusable canvas for the WebAssembly decoder's cropped frame.
      let canvas: HTMLCanvasElement | null = null;
      let ctx: CanvasRenderingContext2D | null = null;
      const frameOf = (): QrSource => {
        reads++;
        if (detector.kind !== 'zxing' || reads % FULL_FRAME_EVERY === 0) return el;
        canvas ??= document.createElement('canvas');
        ctx ??= canvas.getContext('2d', { willReadFrequently: true });
        if (!ctx) return el;
        const box = centreCrop(el.videoWidth, el.videoHeight);
        if (canvas.width !== box.out) canvas.width = canvas.height = box.out;
        ctx.drawImage(el, box.sx, box.sy, box.side, box.side, 0, 0, box.out, box.out);
        return ctx.getImageData(0, 0, box.out, box.out);
      };
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
          let source: QrSource;
          try {
            source = frameOf();
          } catch {
            source = el; // A canvas the browser refused (memory): read the frame as is.
          }
          detector
            .detect(source)
            .then((codes) => {
              if (generation.current !== gen) return;
              failures = 0;
              const took = performance.now() - now;
              if (reads > WARM_READS) {
                average = average === null ? took : average * 0.9 + took * 0.1;
              }
              // A re-render a second is plenty for a number on a test screen.
              if (average !== null && now - shownAt > 1_000) {
                shownAt = now;
                setReadMs(Math.round(average));
              }
              for (const code of codes) {
                if (!code.rawValue) continue;
                lastSeen.current = performance.now();
                onCodeRef.current(code.rawValue);
              }
            })
            .catch(() => {
              // The phone's own reader can start failing mid-night (an
              // update, memory pressure): swap in WebAssembly rather than
              // scan nothing in silence.
              if (detector.kind !== 'native' || ++failures < NATIVE_FAILURES_MAX) return;
              failures = 0;
              void loadFallbackDecoder()
                .then((fallback) => {
                  if (generation.current !== gen) return;
                  detector = fallback;
                  average = null;
                  setDecoder(fallback.kind);
                })
                .catch(() => {});
            })
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
        const caps: CameraCapabilities = track.getCapabilities?.() ?? {};
        setTorch({ available: caps.torch === true, on: false });
        setZoom({ available: (caps.zoom?.max ?? 1) >= 2, level: 1 });
        // Keep refocusing as codes come and go at different distances.
        const facingMode = track.getSettings().facingMode;
        const facing =
          facingMode === 'environment' ? 'back' : facingMode === 'user' ? 'front' : null;
        setLens({ facing, focused: false });
        if (caps.focusMode?.includes('continuous')) {
          const advanced: CameraConstraint[] = [{ focusMode: 'continuous' }];
          void track
            .applyConstraints({ advanced })
            .then(() => {
              if (generation.current === gen) setLens({ facing, focused: true });
            })
            .catch(() => {});
        }
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
      await warmUp(detector);
      if (generation.current !== gen) return;
      lastSeen.current = performance.now();
      setDecoder(detector.kind);
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

  /** 1x or 2x, for a small printed code held further away. */
  const setZoomLevel = useCallback(async (level: 1 | 2) => {
    const track = stream.current?.getVideoTracks()[0];
    if (!track) return;
    const advanced: CameraConstraint[] = [{ zoom: level }];
    try {
      await track.applyConstraints({ advanced });
      setZoom({ available: true, level });
    } catch {
      setZoom({ available: false, level: 1 });
    }
  }, []);

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

  return {
    video,
    state,
    torch,
    zoom,
    readMs,
    decoder,
    lens,
    cameras,
    awake,
    start,
    switchCamera,
    toggleTorch,
    setZoomLevel,
    touch,
  };
}
