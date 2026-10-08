export function sourceMapSettings(
  env: Record<string, string | undefined>,
): { org: string; project: string } | null;
export function normalizeMapReferences(directory: string): Promise<void>;
export function injectNextMaps(
  distDir: string,
  env?: Record<string, string | undefined>,
  execute?: (args: string[]) => Promise<void>,
): Promise<void>;
export function finishImageMaps(
  env?: Record<string, string | undefined>,
  execute?: (args: string[]) => Promise<void>,
): Promise<void>;
