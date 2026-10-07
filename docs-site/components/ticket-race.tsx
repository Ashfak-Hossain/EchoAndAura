'use client';

import { useState } from 'react';
import { ArrowLeft, ArrowRight, RotateCcw } from 'lucide-react';

export function TicketRace() {
  const [step, setStep] = useState(0);
  const [winner, setWinner] = useState<'A' | 'B'>('A');
  const loser = winner === 'A' ? 'B' : 'A';
  const stages = [
    {
      title: 'One ticket remains',
      text: 'Both buyers request one ticket. The page may show one available ticket to both; neither request has reserved it yet.',
      status: ['Ready', 'Ready'],
      lock: 'Unlocked',
    },
    {
      title: `Buyer ${winner} reserves the ticket`,
      text: `Buyer ${winner}'s conditional UPDATE matches and holds the row lock. Buyer ${loser}'s competing UPDATE waits. Registration has not committed yet.`,
      status:
        winner === 'A'
          ? ['Holding row lock', 'Waiting for row lock']
          : ['Waiting for row lock', 'Holding row lock'],
      lock: `Held by ${winner}`,
    },
    {
      title: `Buyer ${winner} commits the order`,
      text: 'The hold, order, and audit row commit together. The row lock is released. The winning reservation is now durable.',
      status:
        winner === 'A'
          ? ['Order committed', 'Ready to recheck']
          : ['Ready to recheck', 'Order committed'],
      lock: 'Released',
    },
    {
      title: `Buyer ${loser} is refused`,
      text: `Buyer ${loser}'s UPDATE evaluates the availability condition against the updated row. Zero rows return, so the service reports sold out. The reserved counter stays at one.`,
      status: winner === 'A' ? ['Reserved', 'Sold out'] : ['Sold out', 'Reserved'],
      lock: 'Unlocked',
    },
  ];
  const stage = stages[step];
  return (
    <section className="ticket-race" aria-label="Two buyers race for the last ticket">
      <p className="eyebrow">ILLUSTRATIVE WALKTHROUGH · STEP {step + 1} OF 4</p>
      <div className="race-scenario">
        <span>First request to update:</span>
        {(['A', 'B'] as const).map((buyer) => (
          <button
            key={buyer}
            aria-pressed={winner === buyer}
            onClick={() => {
              setWinner(buyer);
              setStep(0);
            }}
          >
            Buyer {buyer}
          </button>
        ))}
      </div>
      <div className="race-state" aria-live="polite" aria-atomic="true">
        <h3>{stage.title}</h3>
        <dl className="race-counters">
          <div>
            <dt>Available</dt>
            <dd>{step === 0 ? 1 : 0}</dd>
          </div>
          <div>
            <dt>Reserved</dt>
            <dd>{step === 0 ? 0 : 1}</dd>
          </div>
          <div>
            <dt>Row lock</dt>
            <dd>{stage.lock}</dd>
          </div>
        </dl>
        <div className="race-buyers">
          {(['A', 'B'] as const).map((buyer, index) => (
            <div key={buyer} className={buyer === winner ? 'teal' : 'blue'}>
              <strong>Buyer {buyer}</strong>
              <span>{stage.status[index]}</span>
            </div>
          ))}
        </div>
        <p>{stage.text}</p>
        <p className="simulation-note">
          {step === 1
            ? "Counters show the winner's uncommitted view. Other readers cannot see these changes yet."
            : 'Counters show committed database state.'}
        </p>
      </div>
      <div className="race-controls">
        <button onClick={() => setStep(0)}>
          <RotateCcw size={14} aria-hidden="true" />
          Reset
        </button>
        <div>
          <button disabled={step === 0} onClick={() => setStep(step - 1)}>
            <ArrowLeft size={14} aria-hidden="true" />
            Previous step
          </button>
          <button disabled={step === 3} onClick={() => setStep(step + 1)}>
            Next step
            <ArrowRight size={14} aria-hidden="true" />
          </button>
        </div>
      </div>
      <p className="simulation-note">
        One possible ordering at Read Committed isolation, with both transactions otherwise
        succeeding. This model does not run SQL. The linked Postgres test checks the implementation.
      </p>
    </section>
  );
}
