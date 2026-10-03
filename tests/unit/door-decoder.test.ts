import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// The WebAssembly fallback, without loading any WebAssembly.
const zxingDetect = vi.fn(async () => [{ rawValue: 'from-zxing' }]);
vi.mock('barcode-detector/ponyfill', () => ({
  prepareZXingModule: vi.fn(async () => undefined),
  BarcodeDetector: class {
    detect = zxingDetect;
  },
}));

type Decoder = typeof import('@/app/door/decoder');
async function freshDecoder(): Promise<Decoder> {
  vi.resetModules(); // loadQrDetector caches its choice per page load
  return import('@/app/door/decoder');
}

function installNative(formats: string[] | (() => never)) {
  const detect = vi.fn(async () => [{ rawValue: 'from-native' }]);
  vi.stubGlobal(
    'BarcodeDetector',
    class {
      static getSupportedFormats = async () =>
        typeof formats === 'function' ? formats() : formats;
      detect = detect;
    },
  );
  return detect;
}

describe('centreCrop', () => {
  let centreCrop: Decoder['centreCrop'];
  beforeEach(async () => {
    ({ centreCrop } = await freshDecoder());
  });

  it('takes the centre square of a portrait frame, scaled down to 480', () => {
    // 720 × 1280 (a phone held upright): 75 % of 720 = 540, centred.
    expect(centreCrop(720, 1280)).toEqual({ sx: 90, sy: 370, side: 540, out: 480 });
  });

  it('works the same for a landscape frame', () => {
    expect(centreCrop(1280, 720)).toEqual({ sx: 370, sy: 90, side: 540, out: 480 });
  });

  it('never scales a small crop up', () => {
    expect(centreCrop(480, 640)).toEqual({ sx: 60, sy: 140, side: 360, out: 360 });
  });

  it('stays inside the frame for any fraction and never returns an empty box', () => {
    const box = centreCrop(1, 1, 0.1);
    expect(box.side).toBe(1);
    expect(box.out).toBe(1);
    const full = centreCrop(640, 480, 1);
    expect(full).toEqual({ sx: 80, sy: 0, side: 480, out: 480 });
  });
});

describe('loadQrDetector', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    zxingDetect.mockClear();
  });

  it("uses the browser's own reader when it reads QR codes (Android Chrome)", async () => {
    const nativeDetect = installNative(['ean_13', 'qr_code']);
    const { loadQrDetector } = await freshDecoder();
    const detector = await loadQrDetector();
    expect(detector.kind).toBe('native');
    expect(await detector.detect({} as ImageData)).toEqual([{ rawValue: 'from-native' }]);
    expect(nativeDetect).toHaveBeenCalledTimes(1);
    expect(zxingDetect).not.toHaveBeenCalled();
  });

  it('falls back to WebAssembly when the native reader has no QR support', async () => {
    installNative(['ean_13']);
    const { loadQrDetector } = await freshDecoder();
    const detector = await loadQrDetector();
    expect(detector.kind).toBe('zxing');
    expect(await detector.detect({} as ImageData)).toEqual([{ rawValue: 'from-zxing' }]);
  });

  it('falls back to WebAssembly when the native reader throws (no Play services)', async () => {
    installNative(() => {
      throw new Error('NotSupportedError');
    });
    const { loadQrDetector } = await freshDecoder();
    expect((await loadQrDetector()).kind).toBe('zxing');
  });

  it('falls back to WebAssembly where there is no BarcodeDetector at all (iOS Safari)', async () => {
    const { loadQrDetector } = await freshDecoder();
    expect((await loadQrDetector()).kind).toBe('zxing');
  });

  it('still loads the WebAssembly reader on request, for the offline copy (ADR-035)', async () => {
    installNative(['qr_code']);
    const { loadFallbackDecoder, loadQrDetector } = await freshDecoder();
    expect((await loadQrDetector()).kind).toBe('native');
    const fallback = await loadFallbackDecoder();
    expect(fallback.kind).toBe('zxing');
    expect(loadFallbackDecoder()).toBe(loadFallbackDecoder());
  });

  it('loads once per page: the second call returns the same detector', async () => {
    const { loadQrDetector } = await freshDecoder();
    expect(loadQrDetector()).toBe(loadQrDetector());
  });
});
