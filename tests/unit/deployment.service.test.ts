import { describe, expect, it, vi } from 'vitest';
import { readImageRevision } from '@/server/lib/image-revision';
import { createDeploymentService } from '@/server/services/deployment.service';
import {
  createRevisionRecorder,
  matchesWorkerRevision,
  recordWorkerRevision,
  assertWorkerRevision,
  WORKER_REVISION_KEYS,
} from '@/server/queue/deployment-revision';
import { WORKER_HEARTBEAT_MAX_AGE_MS } from '@/server/queue/heartbeat';

const sha = 'a'.repeat(40);
const other = 'b'.repeat(40);
const now = 1_000_000;
const proof = (revision: string | null = sha, at = now) => JSON.stringify({ revision, at });
const up = async () => undefined;
const down = async () => {
  throw new Error('private-host private-user private-password');
};

describe('image-owned revision', () => {
  it('reads only a strict full-commit manifest', () => {
    expect(readImageRevision(() => JSON.stringify({ revision: sha }))).toBe(sha);
    for (const value of [
      '{}',
      '{',
      'null',
      JSON.stringify({ revision: 'main' }),
      JSON.stringify({ revision: sha, secret: 'private' }),
    ])
      expect(readImageRevision(() => value)).toBeNull();
    expect(
      readImageRevision(() => {
        throw new Error('private path');
      }),
    ).toBeNull();
  });
});

describe('worker revision evidence, separate from health heartbeats', () => {
  it('rejects missing, malformed, unknown, mixed, stale and future evidence', () => {
    expect(matchesWorkerRevision(proof(), sha, now)).toBe(true);
    expect(matchesWorkerRevision(proof(sha, now - WORKER_HEARTBEAT_MAX_AGE_MS), sha, now)).toBe(
      true,
    );
    for (const value of [
      null,
      '{',
      'null',
      proof(null),
      proof(other),
      proof(sha, now + 1),
      proof(sha, now - WORKER_HEARTBEAT_MAX_AGE_MS - 1),
      JSON.stringify({ revision: sha, at: now, secret: 'private' }),
      JSON.stringify({ revision: sha, at: 'today' }),
    ])
      expect(matchesWorkerRevision(value, sha, now)).toBe(false);
  });
  it('writes only its own key with an expiring timestamp and revision', async () => {
    const set = vi.fn().mockResolvedValue('OK');
    await recordWorkerRevision({ set }, sha, WORKER_REVISION_KEYS.holds, now);
    expect(set).toHaveBeenCalledWith(
      WORKER_REVISION_KEYS.holds,
      proof(),
      'PX',
      2 * WORKER_HEARTBEAT_MAX_AGE_MS,
    );
  });
  it('requires both queue roles, not just one worker heartbeat', async () => {
    const get = vi.fn().mockResolvedValue(proof());
    await expect(assertWorkerRevision({ get }, sha, now)).resolves.toBeUndefined();
    expect(get.mock.calls.map(([key]) => key)).toEqual(Object.values(WORKER_REVISION_KEYS));
    get.mockResolvedValueOnce(proof()).mockResolvedValueOnce(proof(other));
    await expect(assertWorkerRevision({ get }, sha, now)).rejects.toThrow('unavailable');
    await expect(assertWorkerRevision({ get }, sha, now, [])).rejects.toThrow('unavailable');
    await expect(assertWorkerRevision({ get }, sha, now, ['same', 'same'])).rejects.toThrow(
      'unavailable',
    );
    get.mockRejectedValue(new Error('private redis address'));
    await expect(assertWorkerRevision({ get }, sha, now)).rejects.toThrow();
  });
  it('recording failure never rejects or waits in a business job', async () => {
    const warning = vi.fn();
    const record = createRevisionRecorder(
      { set: vi.fn().mockRejectedValue(new Error('private')) },
      sha,
      warning,
    );
    expect(record('orders')).toBeUndefined();
    await vi.waitFor(() => expect(warning).toHaveBeenCalledWith());
    const hangs = createRevisionRecorder(
      { set: vi.fn().mockImplementation(() => new Promise(() => undefined)) },
      sha,
      warning,
    );
    expect(hangs('holds')).toBeUndefined();
    const loggingFailure = vi.fn(() => {
      throw new Error('private logger');
    });
    const recordWithBrokenLogger = createRevisionRecorder(
      { set: vi.fn().mockRejectedValue(new Error('private')) },
      sha,
      loggingFailure,
    );
    expect(recordWithBrokenLogger('orders')).toBeUndefined();
    await vi.waitFor(() => expect(loggingFailure).toHaveBeenCalled());
  });
});

describe('deployment service public contract', () => {
  it('confirms only healthy dependencies and matching worker evidence', async () => {
    const worker = vi.fn(up);
    const service = createDeploymentService({
      revision: () => sha,
      health: async () => ({ ok: true }),
      worker,
    });
    expect(await service.check()).toEqual({ revision: sha, ready: true });
    expect(worker).toHaveBeenCalledWith(sha);
  });
  it('does not guess when image metadata is absent or malformed', async () => {
    const worker = vi.fn(up);
    for (const revision of [null, 'main']) {
      const service = createDeploymentService({
        revision: () => revision,
        health: async () => ({ ok: true }),
        worker,
      });
      expect(await service.check()).toEqual({ revision: null, ready: false });
    }
    expect(worker).not.toHaveBeenCalled();
  });
  it('fails closed without exposing any private probe error', async () => {
    const workerDown = createDeploymentService({
      revision: () => sha,
      health: async () => ({ ok: true }),
      worker: down,
    });
    expect(await workerDown.check()).toEqual({ revision: sha, ready: false });
    const metadataDown = createDeploymentService({
      revision: () => {
        throw new Error('private path');
      },
      health: async () => ({ ok: true }),
      worker: up,
    });
    expect(await metadataDown.check()).toEqual({ revision: null, ready: false });
    for (const worker of [up, down]) {
      const service = createDeploymentService({
        revision: () => sha,
        health: async () => ({ ok: false }),
        worker,
      });
      expect(await service.check()).toEqual({ revision: sha, ready: false });
    }
    const service = createDeploymentService({ revision: () => sha, health: down, worker: down });
    expect(JSON.stringify(await service.check())).not.toContain('private');
  });
  it('bounds hung health or revision probes', async () => {
    const hangs = () => new Promise<never>(() => undefined);
    for (const probes of [
      { health: hangs, worker: up },
      { health: async () => ({ ok: true }), worker: hangs },
    ]) {
      const service = createDeploymentService({ revision: () => sha, ...probes }, 15);
      expect(await service.check()).toEqual({ revision: sha, ready: false });
    }
  });
});
