import {
  DeleteObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

/**
 * Object storage behind the S3 API: MinIO locally, Cloudflare R2 in
 * production — only env vars differ. Services depend on the interface; the
 * container constructs the real client lazily so builds and unit tests never
 * need credentials.
 *
 * Uploads are browser → storage via presigned PUT. The Next server never
 * proxies image bytes, and nothing here runs inside a DB transaction
 * (Invariant 7).
 */

export interface UploadTarget {
  /** Presigned PUT URL; the browser sends the file body here. */
  url: string;
  key: string;
  /** Seconds until the URL stops working. */
  expiresInSeconds: number;
}

export interface StoredObjectInfo {
  contentType: string | undefined;
  size: number | undefined;
}

export interface ObjectStorage {
  /** Presign a PUT that is bound to this exact content type and length. */
  createUploadUrl(input: { key: string; contentType: string; size: number }): Promise<UploadTarget>;
  /** Metadata of a stored object, or null when it does not exist. */
  head(key: string): Promise<StoredObjectInfo | null>;
  delete(key: string): Promise<void>;
  publicUrl(key: string): string;
}

export interface StorageEnv {
  endpoint: string;
  accessKeyId: string;
  secretAccessKey: string;
  bucket: string;
  publicUrl: string;
}

const UPLOAD_URL_TTL_SECONDS = 5 * 60;

export function readStorageEnv(env: NodeJS.ProcessEnv = process.env): StorageEnv {
  const get = (name: string): string => {
    const value = env[name];
    if (!value) throw new Error(`${name} is not set — see docs/ENVIRONMENT.md § Object storage`);
    return value;
  };
  return {
    endpoint: get('R2_ENDPOINT'),
    accessKeyId: get('R2_ACCESS_KEY_ID'),
    secretAccessKey: get('R2_SECRET_ACCESS_KEY'),
    bucket: get('R2_BUCKET'),
    publicUrl: get('R2_PUBLIC_URL').replace(/\/+$/, ''),
  };
}

export function createS3ObjectStorage(env: StorageEnv): ObjectStorage {
  const client = new S3Client({
    endpoint: env.endpoint,
    // R2 and MinIO both ignore the region but the SDK requires one.
    region: 'auto',
    credentials: { accessKeyId: env.accessKeyId, secretAccessKey: env.secretAccessKey },
    // Path-style (host/bucket/key): required by MinIO, supported by R2.
    forcePathStyle: true,
  });

  return {
    async createUploadUrl({ key, contentType, size }) {
      const command = new PutObjectCommand({
        Bucket: env.bucket,
        Key: key,
        ContentType: contentType,
        ContentLength: size,
      });
      // Signing ContentType/ContentLength makes the URL reject a body that
      // doesn't match what was validated.
      const url = await getSignedUrl(client, command, {
        expiresIn: UPLOAD_URL_TTL_SECONDS,
        signableHeaders: new Set(['content-type', 'content-length']),
      });
      return { url, key, expiresInSeconds: UPLOAD_URL_TTL_SECONDS };
    },

    async head(key) {
      try {
        const out = await client.send(new HeadObjectCommand({ Bucket: env.bucket, Key: key }));
        return { contentType: out.ContentType, size: out.ContentLength };
      } catch (err: unknown) {
        if (isNotFound(err)) return null;
        throw err;
      }
    },

    async delete(key) {
      await client.send(new DeleteObjectCommand({ Bucket: env.bucket, Key: key }));
    },

    publicUrl(key) {
      return `${env.publicUrl}/${key}`;
    },
  };
}

function isNotFound(err: unknown): boolean {
  if (typeof err !== 'object' || err === null) return false;
  const e = err as { name?: string; $metadata?: { httpStatusCode?: number } };
  return e.name === 'NotFound' || e.name === 'NoSuchKey' || e.$metadata?.httpStatusCode === 404;
}
