import { RELAY_SECRET_MIN_LENGTH, type RelayClaims, signRelayPass } from '@/server/lib/relay-pass';

/**
 * ADR-058: our server's side of the gate relay. The web app hands each
 * door phone a signed pass into its event's room; after each commit it
 * queues an announcement (a check-in, an undo, a revoke), and the worker
 * delivers it, in order, with retries. Off (null) unless both RELAY_URL
 * and RELAY_SECRET are set: the door then shares check-ins by the status
 * ping alone, as before.
 */

export interface RelayConfig {
  /** `https://relay.echoandaura.com` — where the worker announces. */
  httpOrigin: string;
  /** `wss://relay.echoandaura.com` — where door phones connect. */
  wsOrigin: string;
  secret: string;
}

export function readRelayConfig(env: NodeJS.ProcessEnv = process.env): RelayConfig | null {
  const url = env.RELAY_URL?.trim();
  const secret = env.RELAY_SECRET?.trim();
  if (!url && !secret) return null;
  if (!url || !secret) {
    throw new Error('RELAY_URL and RELAY_SECRET go together — set both or neither (ADR-058)');
  }
  if (secret.length < RELAY_SECRET_MIN_LENGTH) {
    throw new Error(
      `RELAY_SECRET must be at least ${RELAY_SECRET_MIN_LENGTH} characters (got ${secret.length})`,
    );
  }
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error('RELAY_URL is not a URL (e.g. https://relay.echoandaura.com)');
  }
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
    throw new Error('RELAY_URL must be http(s)');
  }
  return {
    httpOrigin: parsed.origin,
    wsOrigin: parsed.origin.replace(/^http/, 'ws'),
    secret,
  };
}

/** What our server tells a room, after the commit. */
export type RelayAnnouncement =
  | { kind: 'in'; ticketId: string; at: Date; gate: string | null }
  /** `at`: when the check-in that was undone happened — the room removes only that one. */
  | { kind: 'undo'; ticketId: string; at: Date }
  /** `until`: the last moment the pass's token is valid — the room keeps the revocation that long. */
  | { kind: 'revoke'; passId: string; until: Date };

/** The same, as it travels through the queue and to the relay (JSON). */
export type RelayAnnouncementWire =
  | { kind: 'in'; ticketId: string; at: string; gate: string | null }
  | { kind: 'undo'; ticketId: string; at: string }
  | { kind: 'revoke'; passId: string; until: string };

export function toWire(message: RelayAnnouncement): RelayAnnouncementWire {
  return message.kind === 'revoke'
    ? { ...message, until: message.until.toISOString() }
    : { ...message, at: message.at.toISOString() };
}

export interface RelayTicket {
  /** The room's WebSocket URL for this event. */
  url: string;
  pass: string;
}

export interface DoorRelay {
  /** A door phone's way into its event's room, valid until `until`. */
  ticket(input: {
    eventId: string;
    passId: string;
    gate: string;
    until: Date;
  }): Promise<RelayTicket>;
  /**
   * After a commit: queue the announcement. Never throws, never makes the
   * caller wait. A lost one costs speed only — phones also tell each other,
   * and the status ping still carries the check-in.
   */
  announce(eventId: string, message: RelayAnnouncement): void;
}

export function signRelayTicket(
  config: RelayConfig,
  { eventId, passId, gate, until }: { eventId: string; passId: string; gate: string; until: Date },
): Promise<RelayTicket> {
  const claims: RelayClaims = {
    v: 1,
    role: 'gate',
    eventId,
    passId,
    gate,
    exp: Math.floor(until.getTime() / 1000),
  };
  return signRelayPass(claims, config.secret).then((pass) => ({
    url: `${config.wsOrigin}/events/${eventId}/ws`,
    pass,
  }));
}

/** An announcement that takes longer than this fails (and is retried). */
const ANNOUNCE_TIMEOUT_MS = 5_000;
/** A server pass lives just long enough for its one request. */
const SERVER_PASS_SECONDS = 60;

export type Fetch = (url: string, init: RequestInit) => Promise<Response>;

/** Thrown for a 400: the relay will never take this body — do not retry. */
export class RelayRejectedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'RelayRejectedError';
  }
}

/**
 * The worker's half: deliver one announcement. Throws on any failure so the
 * queue retries it — a revoke that never lands would leave a leaked pass
 * in the room until its window ends.
 */
export function createRelayAnnouncer(
  config: RelayConfig,
  fetchImpl: Fetch = fetch,
  now: () => Date = () => new Date(),
) {
  return {
    async send(eventId: string, message: RelayAnnouncementWire): Promise<void> {
      const token = await signRelayPass(
        {
          v: 1,
          role: 'server',
          eventId,
          exp: Math.floor(now().getTime() / 1000) + SERVER_PASS_SECONDS,
        },
        config.secret,
      );
      const res = await fetchImpl(`${config.httpOrigin}/events/${eventId}/announce`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(message),
        signal: AbortSignal.timeout(ANNOUNCE_TIMEOUT_MS),
      });
      if (res.status === 400) throw new RelayRejectedError(`relay refused the ${message.kind}`);
      if (!res.ok) throw new Error(`relay announce ${message.kind}: HTTP ${res.status}`);
    },
  };
}
