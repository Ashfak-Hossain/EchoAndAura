'use client';

import { useState } from 'react';
import { doorApi } from './door-api';

/**
 * "Enter the gate code" — shown when this phone has no active pass. The
 * pass link (`/door#code=…`) signs in without typing; this form is for a
 * code read out over the phone or copied from the printed pass.
 */
export function DoorSetup({
  message,
  onSignedIn,
}: {
  message: string | null;
  onSignedIn: () => void;
}) {
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending || code.trim() === '') return;
    setPending(true);
    setError(null);
    const reply = await doorApi.signIn(code);
    setPending(false);
    if (reply.ok) return onSignedIn();
    if (reply.kind === 'slow') {
      setError(`Too many tries from here — wait ${Math.ceil(reply.retryAfter / 60)} min.`);
    } else if (reply.kind === 'network') {
      setError('No connection. Check the signal and try again.');
    } else {
      setError(reply.message);
    }
  }

  return (
    <main className="mx-auto flex w-full max-w-md flex-1 flex-col justify-center gap-8 px-5 py-10">
      <div className="flex flex-col gap-2">
        <p className="font-mono text-xs tracking-widest text-white/60 uppercase">
          echoandaura · gate
        </p>
        <h1 className="font-heading text-3xl text-white">Enter the gate code</h1>
        <p className="text-[15px] leading-relaxed text-white/70">
          It is on the gate pass the organizer gave you — 12 letters and numbers, like
          K7QM-4XPD-R2TW.
        </p>
      </div>

      {message ? (
        <p role="status" className="rounded-lg bg-white/10 px-4 py-3 text-[15px] text-white">
          {message}
        </p>
      ) : null}

      <form onSubmit={submit} className="flex flex-col gap-3">
        <label htmlFor="gate-code" className="text-sm font-semibold text-white/80">
          Gate code
        </label>
        <input
          id="gate-code"
          name="code"
          value={code}
          onChange={(e) => setCode(e.target.value.toUpperCase())}
          autoComplete="off"
          autoCapitalize="characters"
          autoCorrect="off"
          spellCheck={false}
          inputMode="text"
          maxLength={40}
          placeholder="XXXX-XXXX-XXXX"
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? 'gate-code-error' : undefined}
          className="h-14 rounded-xl border border-white/25 bg-white/5 px-4 font-mono text-xl tracking-widest text-white placeholder:text-white/30 focus:border-white focus:outline-none"
        />
        {error ? (
          <p id="gate-code-error" role="alert" className="text-[15px] text-[#ff9b93]">
            {error}
          </p>
        ) : null}
        <button
          type="submit"
          disabled={pending}
          className="h-14 rounded-xl bg-[#eda43c] text-lg font-bold text-[#1c1a17] disabled:opacity-60"
        >
          {pending ? 'Checking…' : 'Continue'}
        </button>
      </form>

      <p className="text-sm leading-relaxed text-white/50">
        Door staff see attendee names and ticket types only — never payment or contact details.
      </p>
    </main>
  );
}

/**
 * Messenger, Instagram and friends open links in their own browser, where
 * the camera is often blocked and the pass would be signed in inside the
 * app. Send staff to the real browser, with the pass link in hand.
 */
export function OpenInBrowser({
  app,
  code,
  onContinue,
}: {
  app: string;
  /** The pass code from the link, so the copied link signs in too. */
  code: string | null;
  onContinue: () => void;
}) {
  const [copied, setCopied] = useState(false);
  /** Some in-app webviews block the clipboard: then the link is shown to select by hand. */
  const [manual, setManual] = useState<string | null>(null);
  async function copy() {
    const link = `${window.location.origin}/door${code ? `#code=${encodeURIComponent(code)}` : ''}`;
    try {
      await navigator.clipboard.writeText(link);
      setCopied(true);
    } catch {
      setCopied(false);
      setManual(link);
    }
  }
  return (
    <main className="mx-auto flex w-full max-w-md flex-1 flex-col justify-center gap-6 px-5 py-10">
      <h1 className="font-heading text-3xl text-white">Open this in Safari or Chrome</h1>
      <p className="text-[15px] leading-relaxed text-white/75">
        You are in {app}&apos;s built-in browser, which usually cannot use the camera. Copy the
        link, open Safari (iPhone) or Chrome (Android), and paste it in the address bar.
      </p>
      <button
        type="button"
        onClick={copy}
        className="h-14 rounded-xl bg-[#eda43c] text-lg font-bold text-[#1c1a17]"
      >
        {copied ? 'Copied — now paste it in Safari or Chrome' : 'Copy the link'}
      </button>
      {manual ? (
        <p className="rounded-lg bg-white/10 p-3 font-mono text-sm break-all text-white select-all">
          {manual}
        </p>
      ) : null}
      <button
        type="button"
        onClick={onContinue}
        className="h-12 text-[15px] text-white/60 underline"
      >
        Stay here anyway (typing codes only)
      </button>
    </main>
  );
}
