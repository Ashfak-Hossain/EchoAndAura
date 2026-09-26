/**
 * ADR-035: the service worker's entry. `pnpm sw:build` bundles it to
 * public/door/sw.js (git-ignored; `pnpm build` runs it first).
 */
import { type WorkerScope, installDoorWorker } from './door-worker';

installDoorWorker(self as unknown as WorkerScope);
