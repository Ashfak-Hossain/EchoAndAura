import pino from 'pino';

/**
 * Structured logger for services and the worker. Pretty-printed locally,
 * JSON in production (one line per event, for the VPS log shipper).
 * Never log a trxID or a buyer's contact details at info level: the
 * order id is enough to find the rest in the database.
 */
export const logger = pino({
  level: process.env.LOG_LEVEL ?? (process.env.NODE_ENV === 'production' ? 'info' : 'debug'),
  ...(process.env.NODE_ENV !== 'production' && process.env.NEXT_RUNTIME === undefined
    ? { transport: { target: 'pino-pretty', options: { colorize: true } } }
    : {}),
});
