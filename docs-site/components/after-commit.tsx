'use client';

import { useState } from 'react';

/**
 * Where should registration send its email: inside the database transaction,
 * or after it commits? Pick a place and a failure; the timeline and outcome
 * follow. An illustration of invariant 7, not the app's code: the page shows
 * the real helper and producer as source excerpts.
 */
type Approach = 'inside' | 'after';
type Failure = 'none' | 'insert' | 'email' | 'queue';
type Status = 'ok' | 'fail' | 'undone' | 'skipped' | 'retry';

interface Line {
  text: string;
  status: Status;
  note?: string;
  /** Shown instead of the status word, for the line that ends the transaction. */
  label?: string;
}

interface Outcome {
  order: string;
  stock: string;
  email: string;
  good: boolean;
  verdict: string;
}

const FAILURES: { value: Failure; label: string; afterOnly?: boolean }[] = [
  { value: 'none', label: 'Nothing fails' },
  { value: 'insert', label: 'The audit insert fails' },
  { value: 'email', label: 'The email service is down' },
  { value: 'queue', label: 'The queue is unreachable', afterOnly: true },
];

const STATUS_LABEL: Record<Status, string> = {
  ok: 'done',
  fail: 'failed',
  undone: 'rolled back',
  skipped: 'never runs',
  retry: 'retried',
};

function inside(failure: Failure): { lines: Line[]; outcome: Outcome } {
  const emailDown = failure === 'email';
  const insertFails = failure === 'insert';
  const rolledBack = emailDown || insertFails;
  const lines: Line[] = [
    { text: 'Begin the transaction', status: 'ok' },
    {
      text: 'Reserve two tickets (conditional UPDATE)',
      status: rolledBack ? 'undone' : 'ok',
      note: 'The ticket type row stays locked until the transaction ends.',
    },
    { text: 'Insert the order', status: rolledBack ? 'undone' : 'ok' },
    {
      text: 'Send the payment email (a network request)',
      status: emailDown ? 'fail' : 'ok',
      note: emailDown
        ? 'The send throws, so the transaction rolls back.'
        : 'Every other buyer of this ticket type waits for this reply.',
    },
    {
      text: 'Insert the audit row',
      status: insertFails ? 'fail' : emailDown ? 'skipped' : 'ok',
    },
    {
      text: 'End the transaction',
      status: rolledBack ? 'undone' : 'ok',
      label: rolledBack ? 'rollback' : 'commit',
    },
  ];
  if (insertFails) {
    return {
      lines,
      outcome: {
        order: 'Does not exist',
        stock: 'Released',
        email: 'Already sent',
        good: false,
        verdict:
          'The buyer has payment instructions for an order that does not exist. The rollback undid the database, not the email.',
      },
    };
  }
  if (emailDown) {
    return {
      lines,
      outcome: {
        order: 'Does not exist',
        stock: 'Released',
        email: 'Not sent',
        good: false,
        verdict:
          'An email outage now stops every registration. The order was fine; the email took it down with it.',
      },
    };
  }
  return {
    lines,
    outcome: {
      order: 'pending_payment',
      stock: 'Held',
      email: 'Sent',
      good: false,
      verdict:
        'It works, slowly: the ticket type stayed locked while the email service answered, so competing buyers queued behind a network call.',
    },
  };
}

function after(failure: Failure): { lines: Line[]; outcome: Outcome } {
  const insertFails = failure === 'insert';
  const lines: Line[] = [
    { text: 'Begin the transaction', status: 'ok' },
    { text: 'Reserve two tickets (conditional UPDATE)', status: insertFails ? 'undone' : 'ok' },
    { text: 'Insert the order', status: insertFails ? 'undone' : 'ok' },
    { text: 'Insert the audit row', status: insertFails ? 'fail' : 'ok' },
    {
      text: 'End the transaction',
      status: insertFails ? 'undone' : 'ok',
      label: insertFails ? 'rollback' : 'commit',
    },
    {
      text: 'Queue the payment email (after the commit)',
      status: insertFails ? 'skipped' : failure === 'queue' ? 'fail' : 'ok',
      note:
        failure === 'queue'
          ? 'Gives up after 3 seconds and logs it; the request still succeeds.'
          : undefined,
    },
    {
      text: 'The worker sends it',
      status: insertFails || failure === 'queue' ? 'skipped' : failure === 'email' ? 'retry' : 'ok',
      note:
        failure === 'email'
          ? 'Five attempts, waiting 30 s, 1, 2 and 4 minutes between them.'
          : undefined,
    },
  ];
  const outcomes: Record<Failure, Outcome> = {
    none: {
      order: 'pending_payment',
      stock: 'Held',
      email: 'Sent by the worker',
      good: true,
      verdict:
        'The transaction held its locks only for database work; the email went out on its own time.',
    },
    insert: {
      order: 'Does not exist',
      stock: 'Released',
      email: 'Never queued',
      good: true,
      verdict:
        'Nothing to undo: the hook runs only after a commit, and there was none. The buyer sees an error and can try again.',
    },
    email: {
      order: 'pending_payment',
      stock: 'Held',
      email: 'Retrying',
      good: true,
      verdict:
        'The order stands. The email arrives when the service recovers, and the order page shows the same payment details meanwhile.',
    },
    queue: {
      order: 'pending_payment',
      stock: 'Held',
      email: 'Not queued',
      good: true,
      verdict:
        'The order stands and its page shows the payment details. Nothing replays the email by itself: this is not an outbox.',
    },
  };
  return { lines, outcome: outcomes[failure] };
}

export function AfterCommit() {
  const [approach, setApproach] = useState<Approach>('after');
  const [failure, setFailure] = useState<Failure>('none');
  const { lines, outcome } = approach === 'inside' ? inside(failure) : after(failure);

  function choose(next: Approach) {
    setApproach(next);
    if (next === 'inside' && failure === 'queue') setFailure('none');
  }

  return (
    <div className="after-commit">
      <p className="eyebrow">Illustration · one registration</p>
      <div className="after-commit-controls">
        <div role="group" aria-label="Where the email is sent">
          <span>Send the email</span>
          <button
            type="button"
            aria-pressed={approach === 'inside'}
            onClick={() => choose('inside')}
          >
            Inside the transaction
          </button>
          <button type="button" aria-pressed={approach === 'after'} onClick={() => choose('after')}>
            After the commit
          </button>
        </div>
        <div role="group" aria-label="What fails">
          <span>What fails</span>
          {FAILURES.map((f) => (
            <button
              key={f.value}
              type="button"
              aria-pressed={failure === f.value}
              disabled={f.afterOnly && approach === 'inside'}
              onClick={() => setFailure(f.value)}
            >
              {f.label}
            </button>
          ))}
        </div>
      </div>
      <ol className="after-commit-lines">
        {lines.map((line) => (
          <li key={line.text} data-status={line.status}>
            <span className="after-commit-status">{line.label ?? STATUS_LABEL[line.status]}</span>
            <span>
              {line.text}
              {line.note ? <small>{line.note}</small> : null}
            </span>
          </li>
        ))}
      </ol>
      <div className="after-commit-outcome" data-good={outcome.good} aria-live="polite">
        <dl>
          <div>
            <dt>Order</dt>
            <dd>{outcome.order}</dd>
          </div>
          <div>
            <dt>Stock</dt>
            <dd>{outcome.stock}</dd>
          </div>
          <div>
            <dt>Email</dt>
            <dd>{outcome.email}</dd>
          </div>
        </dl>
        <p>{outcome.verdict}</p>
      </div>
    </div>
  );
}
