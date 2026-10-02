'use client';

import { useEffect, useRef, useState } from 'react';
import type { TurnstileAction } from '@/lib/turnstile-config';

/**
 * ADR-048: Cloudflare Turnstile inside a form. Most visitors never see it
 * (`interaction-only`); a doubtful one gets a checkbox. The widget adds a
 * hidden `cf-turnstile-response` input to the enclosing form, which the
 * server action verifies.
 *
 * The script is injected from this bundle, which the CSP already trusts
 * ('strict-dynamic', ADR-043); only its iframe needs `frame-src`.
 */

interface TurnstileRenderOptions {
  sitekey: string;
  action: string;
  appearance: 'always' | 'execute' | 'interaction-only';
  theme: 'auto' | 'light' | 'dark';
  size: 'normal' | 'flexible' | 'compact';
  'refresh-expired': 'auto' | 'manual' | 'never';
  callback?: (token: string) => void;
  'error-callback'?: () => void;
  'expired-callback'?: () => void;
  'before-interactive-callback'?: () => void;
  'after-interactive-callback'?: () => void;
}

interface TurnstileApi {
  render(container: HTMLElement, options: TurnstileRenderOptions): string | undefined;
  reset(widgetId: string): void;
  remove(widgetId: string): void;
}

declare global {
  interface Window {
    turnstile?: TurnstileApi;
  }
}

const SCRIPT_SRC = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';

let scriptPromise: Promise<TurnstileApi> | null = null;

/**
 * One script per page, however many widgets mount. A failed load clears
 * the cache so the widget's next try (after the server's answer) loads
 * afresh instead of replaying the failure.
 */
function loadTurnstile(): Promise<TurnstileApi> {
  if (window.turnstile) return Promise.resolve(window.turnstile);
  scriptPromise ??= new Promise<TurnstileApi>((resolve, reject) => {
    const script = document.createElement('script');
    script.src = SCRIPT_SRC;
    script.async = true;
    const failed = (message: string) => {
      script.remove();
      scriptPromise = null;
      reject(new Error(message));
    };
    script.onload = () =>
      window.turnstile ? resolve(window.turnstile) : failed('turnstile missing');
    script.onerror = () => failed('turnstile script failed to load');
    document.head.appendChild(script);
  });
  return scriptPromise;
}

export function TurnstileWidget({
  siteKey,
  action,
  resetSignal,
}: {
  siteKey: string;
  action: TurnstileAction;
  /**
   * Pass the form's action state. Each token works once, so after every
   * server answer the widget fetches a fresh one — otherwise a second
   * submit after an error would always fail the check.
   */
  resetSignal: unknown;
}) {
  const container = useRef<HTMLDivElement>(null);
  const widgetId = useRef<string | null>(null);
  const [failed, setFailed] = useState(false);
  // Read by the submit listener, which outlives renders.
  const tokenReady = useRef(false);
  const broken = useRef(false);
  /** A submit made before the token existed, waiting to be sent. */
  const held = useRef<{ submitter: HTMLElement | null } | null>(null);
  const [waiting, setWaiting] = useState(false);
  /** Turnstile wants a click: the status line says so instead of "a moment". */
  const [interactive, setInteractive] = useState(false);
  /** Renders the widget if it isn't; set by the render effect. */
  const ensureRendered = useRef<() => void>(() => {});
  const wrapper = useRef<HTMLDivElement>(null);

  // A submit before the widget has solved would post without a token and be
  // refused: a quick click, a password manager submitting on autofill, or
  // the e2e suite. Hold it and send it once the token arrives — or once the
  // widget has failed, so the server answers with the bot message. React
  // runs no form action for a submit that was default-prevented.
  useEffect(() => {
    const form = container.current?.closest('form');
    if (!form) return;
    const onSubmit = (event: SubmitEvent) => {
      if (tokenReady.current || broken.current) return;
      event.preventDefault();
      held.current = { submitter: event.submitter };
      setWaiting(true);
      // The button can be far from the widget (the sticky bar on mobile
      // registration): bring the status, and any checkbox, into view.
      wrapper.current?.scrollIntoView({ block: 'center' });
    };
    form.addEventListener('submit', onSubmit);
    return () => form.removeEventListener('submit', onSubmit);
  }, []);

  useEffect(() => {
    let cancelled = false;
    const sendHeld = () => {
      const pending = held.current;
      held.current = null;
      setWaiting(false);
      const form = container.current?.closest('form');
      if (!pending || !form) return;
      const { submitter } = pending;
      // requestSubmit takes only one of the form's own submit buttons.
      const button =
        (submitter instanceof HTMLButtonElement || submitter instanceof HTMLInputElement) &&
        submitter.form === form
          ? submitter
          : null;
      form.requestSubmit(button);
    };
    const fail = () => {
      tokenReady.current = false;
      broken.current = true;
      setFailed(true);
      setInteractive(false);
      sendHeld();
    };
    let loading = false;
    const render = () => {
      if (loading || widgetId.current) return;
      loading = true;
      loadTurnstile()
        .then((api) => {
          if (cancelled || !container.current) return;
          widgetId.current =
            api.render(container.current, {
              sitekey: siteKey,
              action,
              appearance: 'interaction-only',
              // The site is light-only (ADR-008); 'auto' would follow a
              // dark OS into a dark box on a light form.
              theme: 'light',
              // 'normal' is a fixed 300 px; a 320 px phone leaves less.
              size: container.current.clientWidth < 300 ? 'compact' : 'normal',
              'refresh-expired': 'auto',
              callback: () => {
                tokenReady.current = true;
                broken.current = false;
                setFailed(false);
                setInteractive(false);
                sendHeld();
              },
              'error-callback': fail,
              // Refreshed automatically; until then a submit waits.
              'expired-callback': () => {
                tokenReady.current = false;
              },
              'before-interactive-callback': () => {
                setInteractive(true);
                // A submit is waiting on this click: make sure it's seen.
                if (held.current) wrapper.current?.scrollIntoView({ block: 'center' });
              },
              'after-interactive-callback': () => setInteractive(false),
            }) ?? null;
          // A retry that rendered: submits wait for its token again
          // rather than going out without one.
          if (widgetId.current) {
            broken.current = false;
            setFailed(false);
          }
        })
        .catch(() => {
          if (!cancelled) fail();
        })
        .finally(() => {
          loading = false;
        });
    };
    ensureRendered.current = render;
    render();
    return () => {
      cancelled = true;
      ensureRendered.current = () => {};
      if (widgetId.current) window.turnstile?.remove(widgetId.current);
      widgetId.current = null;
    };
  }, [siteKey, action]);

  // Skip the first render: the widget is fresh then.
  const firstSignal = useRef(true);
  useEffect(() => {
    if (firstSignal.current) {
      firstSignal.current = false;
      return;
    }
    // The script never loaded (a dropped request on a flaky connection):
    // try again now, or every later submit is refused until a refresh,
    // which would lose the typed form.
    if (!widgetId.current) {
      ensureRendered.current();
      return;
    }
    // The token just sent is spent; the next submit waits for a new one.
    tokenReady.current = false;
    window.turnstile?.reset(widgetId.current);
  }, [resetSignal]);

  return (
    <div ref={wrapper} className="flex flex-col gap-2">
      {/* Empty (zero height) unless Turnstile wants an interaction. */}
      <div ref={container} />
      {waiting ? (
        <p role="status" className="text-sm leading-relaxed text-muted-foreground">
          {interactive
            ? 'Tick the box above to send the form.'
            : 'Checking you are not a bot — your form will send in a moment.'}
        </p>
      ) : null}
      {failed ? (
        <p role="status" className="text-sm leading-relaxed text-muted-foreground">
          The bot check could not load. Refresh the page, or try another browser — a strict content
          blocker can stop it.
        </p>
      ) : null}
      <noscript>
        <p className="text-sm leading-relaxed text-muted-foreground">
          Please turn on JavaScript to send this form — it runs a quick check that you are not a
          bot.
        </p>
      </noscript>
    </div>
  );
}
