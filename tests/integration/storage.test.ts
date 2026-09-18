import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { createS3ObjectStorage, readStorageEnv } from '@/server/storage/object-storage';

/**
 * Round-trip against real S3-compatible storage (MinIO via docker compose
 * locally; the same code hits R2 in production). Proves the presigned PUT is
 * bound to the declared type/size, and that head/delete/publicUrl agree.
 *
 * Needs R2_* in the environment — run `pnpm test:integration`. Missing env
 * fails loudly rather than skipping, so a misconfigured CI can't go green.
 */

describe('object storage (S3-compatible)', () => {
  const storage = createS3ObjectStorage(readStorageEnv());
  const body = new TextEncoder().encode('PNG not really, but bytes are bytes');

  it('presigns a PUT bound to type and size, then head/publicUrl/delete agree', async () => {
    const key = `test/${randomUUID()}/cover-abcdefghijkl.png`;
    const target = await storage.createUploadUrl({
      key,
      contentType: 'image/png',
      size: body.byteLength,
    });

    const put = await fetch(target.url, {
      method: 'PUT',
      headers: {
        'Content-Type': 'image/png',
        'Content-Length': String(body.byteLength),
      },
      body,
    });
    expect(put.status).toBe(200);

    const info = await storage.head(key);
    expect(info).toEqual({ contentType: 'image/png', size: body.byteLength });

    // Anonymous download is enabled on the bucket (minio-init), like an R2 public bucket.
    const get = await fetch(storage.publicUrl(key));
    expect(get.status).toBe(200);
    expect(new Uint8Array(await get.arrayBuffer())).toEqual(body);

    await storage.delete(key);
    expect(await storage.head(key)).toBeNull();
  });

  it('rejects a PUT whose content type differs from what was signed', async () => {
    const key = `test/${randomUUID()}/cover-abcdefghijkl.png`;
    const target = await storage.createUploadUrl({
      key,
      contentType: 'image/png',
      size: body.byteLength,
    });

    const put = await fetch(target.url, {
      method: 'PUT',
      headers: {
        'Content-Type': 'text/html',
        'Content-Length': String(body.byteLength),
      },
      body,
    });
    expect(put.status).toBe(403);
    expect(await storage.head(key)).toBeNull();
  });
});
