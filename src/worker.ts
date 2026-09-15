/**
 * BullMQ worker entrypoint (runs as a separate Node process: `pnpm worker`).
 *
 * Job processors are registered in later phases:
 *   - Phase 3: the 24-hour inventory hold-expiry job.
 *   - Phase 4: the ticket-delivery email.
 *
 * It imports business logic from src/server/** directly and must never import
 * from next/* (CLAUDE.md — the worker is not a Next.js runtime).
 *
 * Foundation stub: no processors registered yet.
 */
export {};
