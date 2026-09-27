/**
 * ADR-030: the QR decoder is zxing-cpp compiled to WebAssembly (through
 * the `barcode-detector` ponyfill — iOS Safari has no native
 * BarcodeDetector). The .wasm is served from our own origin, never a CDN:
 * a gate cannot depend on a third party being up, and we know exactly
 * what runs. The file name carries the version; a unit test checks its
 * SHA-256 against the one the package ships.
 */
export const ZXING_WASM_URL = '/vendor/zxing_reader-3.1.3.wasm';

/** What the ponyfill's detector does for us: QR codes in a video frame. */
export interface QrDetector {
  detect(source: HTMLVideoElement): Promise<{ rawValue: string }[]>;
}

let detector: Promise<QrDetector> | null = null;

/** Loads the decoder once (dynamic import: only /door ever pays for it). */
export function loadQrDetector(): Promise<QrDetector> {
  if (detector) return detector;
  const loading = import('barcode-detector/ponyfill').then(async (m) => {
    await m.prepareZXingModule({
      overrides: {
        locateFile: (path: string, prefix: string) =>
          path.endsWith('.wasm') ? ZXING_WASM_URL : prefix + path,
      },
      fireImmediately: true,
    });
    return new m.BarcodeDetector({ formats: ['qr_code'] });
  });
  // A failed load (a network blip) must not stick: the next Start retries.
  loading.catch(() => {
    if (detector === loading) detector = null;
  });
  detector = loading;
  return loading;
}
