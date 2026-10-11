'use client';

import { useState, useTransition } from 'react';
import { Button } from '@/components/button';
import { SyntheticTestError } from '@/lib/error-tracking/synthetic';
import {
  queueWorkerFailure,
  reportCaughtServerError,
  throwUnhandledServerError,
  type DiagnosticResult,
} from './actions';

/** Throws while rendering, so the admin error boundary reports it from the browser. */
function BrowserFailure({ armed }: { armed: boolean }) {
  if (armed) throw new SyntheticTestError();
  return null;
}

interface Check {
  id: string;
  title: string;
  proves: string;
  action: () => Promise<DiagnosticResult>;
  /** Shown when the action throws on purpose. */
  thrown?: string;
}

const checks: Check[] = [
  {
    id: 'server-unhandled',
    title: 'Unhandled server error',
    proves: 'Next’s request-error hook on the web server (operation “action”).',
    action: throwUnhandledServerError,
    // The throw is the point: catching it here keeps the browser's boundary out of it.
    thrown: 'The server threw, as intended.',
  },
  {
    id: 'server-caught',
    title: 'Caught server error',
    proves: 'Reporting from a server action, as the order actions do (operation “diagnostics”).',
    action: reportCaughtServerError,
  },
  {
    id: 'worker-terminal',
    title: 'Worker failure',
    proves: 'A job that fails its only attempt, reported by the worker (queue “orders”).',
    action: queueWorkerFailure,
  },
];

export function DiagnosticsPanel() {
  const [armed, setArmed] = useState(false);
  const [results, setResults] = useState<Record<string, string>>({});
  const [pending, startTransition] = useTransition();

  const run = (id: string, action: () => Promise<DiagnosticResult>, thrown?: string) =>
    startTransition(async () => {
      let message: string;
      try {
        message = (await action()).message;
      } catch {
        message = thrown ?? 'The action failed unexpectedly.';
      }
      setResults((current) => ({ ...current, [id]: message }));
    });

  return (
    <>
      <BrowserFailure armed={armed} />
      <ul className="flex flex-col gap-3">
        <li className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border bg-card p-4">
          <div>
            <p className="font-semibold">Browser error</p>
            <p className="text-sm text-muted-foreground">
              The admin error boundary, reported from this browser. The page shows its error screen.
            </p>
          </div>
          <Button variant="secondary" onClick={() => setArmed(true)}>
            Throw in the browser
          </Button>
        </li>
        {checks.map(({ id, title, proves, action, thrown }) => (
          <li
            key={id}
            className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border bg-card p-4"
          >
            <div>
              <p className="font-semibold">{title}</p>
              <p className="text-sm text-muted-foreground">{proves}</p>
              {results[id] ? (
                <p role="status" className="mt-1 text-sm">
                  {results[id]}
                </p>
              ) : null}
            </div>
            <Button variant="secondary" disabled={pending} onClick={() => run(id, action, thrown)}>
              Run
            </Button>
          </li>
        ))}
      </ul>
    </>
  );
}
