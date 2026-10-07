import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { z } from 'zod';

export const gitRevision = z.string().regex(/^[a-f0-9]{40}$/);
const manifest = z.object({ revision: gitRevision }).strict();

/** Image-owned metadata, never a runtime environment override or mutable tag. */
export function readImageRevision(
  read: () => string = () => readFileSync(join(process.cwd(), 'deployment-revision.json'), 'utf8'),
): string | null {
  try {
    const parsed = manifest.safeParse(JSON.parse(read()));
    return parsed.success ? parsed.data.revision : null;
  } catch {
    // Local dev and pre-D3B images have no manifest. Never guess a revision.
    return null;
  }
}
