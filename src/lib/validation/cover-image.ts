import { z } from 'zod';
import { COVER_IMAGE_MAX_BYTES } from '@/server/lib/cover-image';

/** Payloads of the two cover-image server actions (JSON from the client). */

export const coverUploadRequestSchema = z.object({
  contentType: z.string().trim().min(1).max(100),
  size: z.number().int().positive().max(COVER_IMAGE_MAX_BYTES),
});

export const coverImageKeySchema = z
  .string()
  .trim()
  .min(1)
  .max(200)
  // Keys are plain path segments; anything else is not one we issued.
  .regex(/^[A-Za-z0-9/_.-]+$/);
