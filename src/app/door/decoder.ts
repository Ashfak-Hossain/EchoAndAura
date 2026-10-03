/**
 * ADR-030: the QR decoder is zxing-cpp compiled to WebAssembly (through
 * the `barcode-detector` ponyfill — iOS Safari has no native
 * BarcodeDetector). The .wasm is served from our own origin, never a CDN:
 * a gate cannot depend on a third party being up, and we know exactly
 * what runs. The file name carries the version; a unit test checks its
 * SHA-256 against the one the package ships.
 *
 * Where the browser has its own BarcodeDetector that reads QR codes
 * (Chrome on Android: Google's on-device reader, hardware-accelerated) it is
 * used instead — several times faster than WebAssembly on the same phone —
 * and the .wasm is never downloaded.
 */
export const ZXING_WASM_URL = '/vendor/zxing_reader-3.1.3.wasm';

/** What the camera loop hands the decoder: the live video, or a cropped frame. */
export type QrSource = HTMLVideoElement | ImageData;

/** QR codes in a frame. `native`: the browser's own reader, fast on the full frame. */
export interface QrDetector {
  kind: 'native' | 'zxing';
  detect(source: QrSource): Promise<{ rawValue: string }[]>;
}

interface NativeBarcodeDetector {
  detect(source: QrSource): Promise<{ rawValue: string }[]>;
}
interface NativeBarcodeDetectorClass {
  new (options: { formats: string[] }): NativeBarcodeDetector;
  getSupportedFormats(): Promise<string[]>;
}

async function nativeDetector(): Promise<QrDetector | null> {
  const Native = (globalThis as { BarcodeDetector?: NativeBarcodeDetectorClass }).BarcodeDetector;
  if (!Native?.getSupportedFormats) return null;
  try {
    if (!(await Native.getSupportedFormats()).includes('qr_code')) return null;
    const native = new Native({ formats: ['qr_code'] });
    return { kind: 'native', detect: (source) => native.detect(source) };
  } catch {
    // Declared but unusable (no Google Play services, a locked-down build).
    return null;
  }
}

async function zxingDetector(): Promise<QrDetector> {
  const m = await import('barcode-detector/ponyfill');
  await m.prepareZXingModule({
    overrides: {
      locateFile: (path: string, prefix: string) =>
        path.endsWith('.wasm') ? ZXING_WASM_URL : prefix + path,
    },
    fireImmediately: true,
  });
  const zxing = new m.BarcodeDetector({ formats: ['qr_code'] });
  return { kind: 'zxing', detect: (source) => zxing.detect(source) };
}

let detector: Promise<QrDetector> | null = null;
let fallback: Promise<QrDetector> | null = null;

/**
 * The WebAssembly reader, loaded once. The scanner also loads it on phones
 * that use their own reader, just before the page saves itself for a
 * reload without signal (ADR-035): that saved copy must hold a reader that
 * needs nothing from the phone.
 */
export function loadFallbackDecoder(): Promise<QrDetector> {
  if (fallback) return fallback;
  const loading = zxingDetector();
  loading.catch(() => {
    if (fallback === loading) fallback = null;
  });
  fallback = loading;
  return loading;
}

/** Loads the decoder once (dynamic import: only /door ever pays for it). */
export function loadQrDetector(): Promise<QrDetector> {
  if (detector) return detector;
  const loading = nativeDetector().then((native) => native ?? loadFallbackDecoder());
  // A failed load (a network blip) must not stick: the next Start retries.
  loading.catch(() => {
    if (detector === loading) detector = null;
  });
  detector = loading;
  return loading;
}

/** The part of a frame the WebAssembly decoder reads, and the size it is scaled to. */
export interface CropBox {
  sx: number;
  sy: number;
  side: number;
  /** Output width and height (square): never more than `maxSide`. */
  out: number;
}

/**
 * The centre square of a `width` × `height` frame, `fraction` of its short
 * side, scaled down to at most `maxSide` pixels. The viewfinder asks staff
 * to hold the code in the centre; reading only that square, smaller, is
 * what makes WebAssembly fast enough on a mid-range phone (a 720p frame is
 * nine times the pixels). Codes held elsewhere are caught by an occasional
 * full-frame read.
 */
export function centreCrop(width: number, height: number, fraction = 0.75, maxSide = 480): CropBox {
  const side = Math.max(1, Math.round(Math.min(width, height) * fraction));
  return {
    sx: Math.round((width - side) / 2),
    sy: Math.round((height - side) / 2),
    side,
    out: Math.min(side, maxSide),
  };
}
