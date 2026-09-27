'use client';

import { useCallback, useRef } from 'react';
import { isIos } from './platform';

/**
 * Beep and buzz for each answer, so staff know without reading the screen.
 * Must be unlocked inside a tap (Start / Tap to resume): phones only allow
 * sound that a gesture started.
 *
 * iOS mutes Web Audio on the silent switch. Safari 17+ lifts that with
 * `navigator.audioSession.type = 'playback'`; older iOS falls back to
 * `<audio>` elements, which play through the switch. Vibration is
 * Android-only (iOS Safari has no Vibration API).
 */

export type FeedbackKind = 'admit' | 'warn' | 'deny' | 'practice';

interface Tone {
  freq: number;
  ms: number;
  square?: boolean;
}

const TONES: Record<FeedbackKind, Tone[]> = {
  admit: [{ freq: 1175, ms: 130 }],
  practice: [{ freq: 784, ms: 130 }],
  warn: [
    { freq: 740, ms: 110 },
    { freq: 740, ms: 110 },
  ],
  deny: [{ freq: 196, ms: 450, square: true }],
};
const VIBRATE: Record<FeedbackKind, number[]> = {
  admit: [60],
  practice: [40],
  warn: [80, 60, 80],
  deny: [300, 100, 300],
};
const GAP_MS = 70;
const VOLUME = 0.35;
const KINDS = Object.keys(TONES) as FeedbackKind[];

type AudioSessionNavigator = Navigator & { audioSession?: { type: string } };
type WebkitWindow = Window & { webkitAudioContext?: typeof AudioContext };

/** A tone sequence as a 16-bit mono WAV, for the `<audio>` fallback. */
function toneWavUrl(tones: Tone[]): string {
  const rate = 22_050;
  const gap = Math.round((rate * GAP_MS) / 1000);
  const lengths = tones.map((t) => Math.round((rate * t.ms) / 1000));
  const samples = lengths.reduce((a, b) => a + b, 0) + gap * (tones.length - 1);
  const view = new DataView(new ArrayBuffer(44 + samples * 2));
  const ascii = (at: number, s: string) => {
    for (let i = 0; i < s.length; i++) view.setUint8(at + i, s.charCodeAt(i));
  };
  ascii(0, 'RIFF');
  view.setUint32(4, 36 + samples * 2, true);
  ascii(8, 'WAVE');
  ascii(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, 1, true); // mono
  view.setUint32(24, rate, true);
  view.setUint32(28, rate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  ascii(36, 'data');
  view.setUint32(40, samples * 2, true);
  let at = 44;
  const fade = Math.round(rate * 0.005);
  tones.forEach((tone, i) => {
    const n = lengths[i]!;
    for (let s = 0; s < n; s++) {
      const phase = Math.sin((2 * Math.PI * tone.freq * s) / rate);
      const wave = tone.square ? Math.sign(phase) : phase;
      const envelope = Math.min(1, s / fade, (n - s) / fade);
      view.setInt16(at, Math.round(wave * envelope * VOLUME * 32_767), true);
      at += 2;
    }
    if (i < tones.length - 1) at += gap * 2; // silence: the buffer starts zeroed
  });
  return URL.createObjectURL(new Blob([view.buffer], { type: 'audio/wav' }));
}

export function useFeedback() {
  const context = useRef<AudioContext | null>(null);
  const elements = useRef<Map<FeedbackKind, HTMLAudioElement> | null>(null);

  /** Call from inside a tap. Safe to call again (Tap to resume). */
  const unlock = useCallback(() => {
    const nav = navigator as AudioSessionNavigator;
    if (nav.audioSession) {
      try {
        nav.audioSession.type = 'playback';
      } catch {
        // Not settable here: Web Audio still works with the ringer on.
      }
    }
    if (nav.audioSession || !isIos(navigator.userAgent, navigator.maxTouchPoints)) {
      const Ctor = window.AudioContext ?? (window as WebkitWindow).webkitAudioContext;
      if (!Ctor) return;
      context.current ??= new Ctor();
      void context.current.resume().catch(() => {});
      return;
    }
    elements.current ??= new Map(KINDS.map((k) => [k, new Audio(toneWavUrl(TONES[k]))]));
    for (const el of elements.current.values()) {
      // A muted play inside the gesture unlocks the element for later.
      el.muted = true;
      void el
        .play()
        .then(() => {
          el.pause();
          el.currentTime = 0;
          el.muted = false;
        })
        .catch(() => {
          el.muted = false;
        });
    }
  }, []);

  const play = useCallback((kind: FeedbackKind) => {
    if ('vibrate' in navigator) navigator.vibrate(VIBRATE[kind]);
    const ctx = context.current;
    if (ctx) {
      // iOS leaves it 'interrupted' after a lock or a call; any gesture since
      // counts, so asking again here is allowed.
      if (ctx.state !== 'running') void ctx.resume().catch(() => {});
      let t = ctx.currentTime + 0.01;
      for (const tone of TONES[kind]) {
        const end = t + tone.ms / 1000;
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = tone.square ? 'square' : 'sine';
        osc.frequency.value = tone.freq;
        gain.gain.setValueAtTime(0, t);
        gain.gain.linearRampToValueAtTime(VOLUME, t + 0.005);
        gain.gain.setValueAtTime(VOLUME, end - 0.01);
        gain.gain.linearRampToValueAtTime(0, end);
        osc.connect(gain).connect(ctx.destination);
        osc.start(t);
        osc.stop(end + 0.02);
        t = end + GAP_MS / 1000;
      }
      return;
    }
    const el = elements.current?.get(kind);
    if (el) {
      el.currentTime = 0;
      void el.play().catch(() => {});
    }
  }, []);

  return { unlock, play };
}
