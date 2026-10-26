import { createHash } from 'node:crypto';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

// ADR-030, ADR-084: the door scanner's decoder is served from our own origin,
// but the .wasm is not committed. Each build copies it out of the zxing-wasm
// that barcode-detector runs (resolved from inside barcode-detector, as the
// ponyfill does), so the bytes come from the lockfile, checked by hash on
// install, and the glue code and the .wasm cannot drift apart.
const fromDetector = createRequire(
  createRequire(import.meta.url).resolve('barcode-detector/ponyfill'),
);

/** The installed decoder: where its .wasm is, and what it says the file is. */
export async function installedZxing() {
  const reader = await import(pathToFileURL(fromDetector.resolve('zxing-wasm/reader')).href);
  return {
    source: fromDetector.resolve('zxing-wasm/reader/zxing_reader.wasm'),
    version: reader.ZXING_WASM_VERSION,
    sha256: reader.ZXING_WASM_SHA256,
  };
}

/**
 * Replaces `<publicDir>/vendor/` with the one .wasm, named by version (the
 * served files are cached as immutable, so a new version needs a new name).
 * Refuses a file whose SHA-256 differs from the one the package publishes.
 */
export async function copyZxingWasm(publicDir, zxing) {
  const { source, version, sha256 } = zxing ?? (await installedZxing());
  if (!/^\d+\.\d+\.\d+$/.test(version ?? '')) throw new Error('zxing-wasm has no version');
  const bytes = await readFile(source);
  const actual = createHash('sha256').update(bytes).digest('hex');
  if (actual !== sha256) {
    throw new Error(`zxing_reader.wasm is not the file zxing-wasm ${version} publishes`);
  }
  const dir = join(publicDir, 'vendor');
  await rm(dir, { recursive: true, force: true });
  await mkdir(dir, { recursive: true });
  const name = `zxing_reader-${version}.wasm`;
  await writeFile(join(dir, name), bytes);
  return `/vendor/${name}`;
}

// import.meta.main, not an argv comparison: argv[1] is not resolved through
// symlinks, and a silent no-op would ship a build without the decoder.
if (import.meta.main) {
  await copyZxingWasm(resolve('public'));
}
