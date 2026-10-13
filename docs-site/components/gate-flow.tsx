'use client';

import { RotateCcw } from 'lucide-react';
import { useState } from 'react';

/**
 * Two gates, one ticket, a signal that comes and goes. A deterministic model
 * of the door rules (ADR-030/034/058), not their code: the tour quotes the
 * real check-in and offline judgement. "No signal" means no network at all,
 * so neither the server nor the relay can be reached.
 */
type GateId = 'A' | 'B';

interface CheckIn {
  gate: GateId;
  at: string;
  offline: boolean;
}

interface Gate {
  online: boolean;
  /** What this phone believes: from its own admits, the relay or the ping. */
  knowsIn: CheckIn | null;
  /** Offline admits waiting to be sent. */
  outbox: CheckIn[];
  answer: { text: string; tone: 'admit' | 'refuse'; offline: boolean } | null;
}

interface World {
  minute: number;
  server: CheckIn | null;
  doubleEntry: boolean;
  gates: Record<GateId, Gate>;
  log: string[];
}

const START: World = {
  minute: 0,
  server: null,
  doubleEntry: false,
  gates: {
    A: { online: true, knowsIn: null, outbox: [], answer: null },
    B: { online: true, knowsIn: null, outbox: [], answer: null },
  },
  log: ["Doors open. Both phones have the offline list: Mina's ticket is not in yet."],
};

const clock = (minute: number) => `8:${String(51 + minute).padStart(2, '0')} PM`;
const describe = (c: CheckIn) => `Gate ${c.gate} at ${c.at}${c.offline ? ', offline' : ''}`;

/** The server's news reaches every gate that has signal (relay and ping). */
function spread(world: World): World {
  if (!world.server) return world;
  const gates = { ...world.gates };
  for (const id of ['A', 'B'] as const) {
    if (gates[id].online && !gates[id].knowsIn) gates[id] = { ...gates[id], knowsIn: world.server };
  }
  return { ...world, gates };
}

function scan(world: World, id: GateId): World {
  const at = clock(world.minute);
  const gate = world.gates[id];
  const next = { ...world, minute: world.minute + 1, gates: { ...world.gates } };
  if (gate.online) {
    // The server decides: one conditional UPDATE.
    if (world.server) {
      next.gates[id] = {
        ...gate,
        knowsIn: world.server,
        answer: { text: `Already in: ${describe(world.server)}`, tone: 'refuse', offline: false },
      };
      next.log = [
        ...world.log,
        `${at} Gate ${id}: the UPDATE matches no row. Already in, ${describe(world.server)}.`,
      ];
      return next;
    }
    const checkIn = { gate: id, at, offline: false };
    next.server = checkIn;
    next.gates[id] = {
      ...gate,
      knowsIn: checkIn,
      answer: { text: 'Admit', tone: 'admit', offline: false },
    };
    next.log = [
      ...world.log,
      `${at} Gate ${id}: one UPDATE admits Mina. The relay tells every gate with signal.`,
    ];
    return spread(next);
  }
  // No signal: judge from the list and what this phone has heard.
  if (gate.knowsIn) {
    next.gates[id] = {
      ...gate,
      answer: { text: `Already in: ${describe(gate.knowsIn)}`, tone: 'refuse', offline: true },
    };
    next.log = [
      ...world.log,
      `${at} Gate ${id}, no signal: the phone already heard Mina is in. Refused from the list.`,
    ];
    return next;
  }
  const admit = { gate: id, at, offline: true };
  next.gates[id] = {
    ...gate,
    knowsIn: admit,
    outbox: [...gate.outbox, admit],
    answer: { text: 'Admit', tone: 'admit', offline: true },
  };
  next.log = [
    ...world.log,
    `${at} Gate ${id}, no signal: the list says not in yet. Admitted offline, scan saved to the outbox.`,
  ];
  return next;
}

function setSignal(world: World, id: GateId, online: boolean): World {
  const at = clock(world.minute);
  let next: World = {
    ...world,
    minute: world.minute + 1,
    gates: { ...world.gates, [id]: { ...world.gates[id], online } },
  };
  if (!online) {
    next.log = [...world.log, `${at} Gate ${id} loses signal.`];
    return next;
  }
  const lines = [`${at} Gate ${id} has signal again.`];
  // Sync the outbox: each offline admit is replayed with the same UPDATE.
  for (const scanned of world.gates[id].outbox) {
    const first = next.server;
    if (!first) {
      next = { ...next, server: scanned };
      lines.push(
        `Sync: the replay admits Mina, dated ${scanned.at} (when she walked in), marked offline.`,
      );
    } else {
      next = { ...next, doubleEntry: true };
      lines.push(
        `Sync: the replay matches no row, ${describe(first)} came first. Recorded as a double entry for the organizer, counted once.`,
      );
    }
  }
  next = {
    ...next,
    gates: {
      ...next.gates,
      [id]: { ...next.gates[id], outbox: [], knowsIn: next.server ?? next.gates[id].knowsIn },
    },
    log: [...next.log, ...lines],
  };
  return spread(next);
}

function GatePanel({
  id,
  gate,
  onScan,
  onSignal,
}: {
  id: GateId;
  gate: Gate;
  onScan: () => void;
  onSignal: () => void;
}) {
  return (
    <section className="gate-panel" aria-label={`Gate ${id}`}>
      <header>
        <strong>Gate {id}</strong>
        <span data-online={gate.online}>{gate.online ? 'Signal' : 'No signal'}</span>
      </header>
      <div className="gate-answer" data-tone={gate.answer?.tone ?? 'none'} aria-live="polite">
        {gate.answer ? (
          <>
            {gate.answer.text}
            {gate.answer.offline ? <small>offline</small> : null}
          </>
        ) : (
          'Waiting for a guest'
        )}
      </div>
      <p className="gate-meta">
        Outbox: {gate.outbox.length} · Knows Mina is in: {gate.knowsIn ? 'yes' : 'no'}
      </p>
      <div className="gate-buttons">
        <button type="button" onClick={onScan}>
          Scan Mina&apos;s ticket at Gate {id}
        </button>
        <button type="button" onClick={onSignal}>
          {gate.online ? `Drop Gate ${id}'s signal` : `Restore Gate ${id}'s signal`}
        </button>
      </div>
    </section>
  );
}

export function GateFlow() {
  const [world, setWorld] = useState<World>(START);
  return (
    <div className="gate-flow">
      <p className="eyebrow">Illustration · two gates, one ticket</p>
      <div className="gate-panels">
        {(['A', 'B'] as const).map((id) => (
          <GatePanel
            key={id}
            id={id}
            gate={world.gates[id]}
            onScan={() => setWorld((w) => scan(w, id))}
            onSignal={() => setWorld((w) => setSignal(w, id, !w.gates[id].online))}
          />
        ))}
      </div>
      <div className="gate-server" data-double={world.doubleEntry}>
        <strong>Server (Postgres decides)</strong>
        <span>
          {world.server ? `Mina is in: ${describe(world.server)}` : 'Mina is not checked in'}
          {world.doubleEntry
            ? " · Double entry recorded: an offline admit arrived after another gate's"
            : ''}
        </span>
      </div>
      <ol className="gate-log">
        {world.log.map((line, i) => (
          <li key={i}>{line}</li>
        ))}
      </ol>
      <div className="gate-reset">
        <button type="button" onClick={() => setWorld(START)}>
          <RotateCcw aria-hidden size={14} /> Reset
        </button>
      </div>
    </div>
  );
}
