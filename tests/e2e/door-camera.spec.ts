import { writeFileSync } from 'node:fs';
import QRCode from 'qrcode';
import { expect, test } from './test';
import { signInAsAdmin } from './fixtures/admin';
import { issuedOrder, newGatePass, openDoors, publishedEvent } from './door-helpers';

/**
 * The real camera path, end to end: Chromium's fake camera plays a video of
 * a real ticket QR, the scanner reads it from the frames (no typing), and
 * the server admits it. Also records how fast one read is on this machine.
 */

const W = 640;
const H = 480;

/**
 * A Y4M video (the format Chromium's fake camera plays): `blank` grey frames,
 * then `shown` frames with `text` as a QR code in the centre. Grey only: the
 * colour planes stay neutral.
 */
function qrVideo(path: string, text: string, blank = 15, shown = 45): void {
  const qr = QRCode.create(text, { errorCorrectionLevel: 'M' });
  const n = qr.modules.size;
  const scale = Math.floor(260 / (n + 8)); // ~260 px with a 4-module quiet zone
  const size = (n + 8) * scale;
  const ox = Math.floor((W - size) / 2);
  const oy = Math.floor((H - size) / 2);

  const grey = Buffer.alloc(W * H, 110);
  const code = Buffer.alloc(W * H, 110);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const mx = Math.floor(x / scale) - 4;
      const my = Math.floor(y / scale) - 4;
      const dark = mx >= 0 && my >= 0 && mx < n && my < n && qr.modules.get(my, mx) === 1;
      code[(oy + y) * W + ox + x] = dark ? 16 : 235;
    }
  }
  const chroma = Buffer.alloc((W / 2) * (H / 2) * 2, 128);
  const header = Buffer.from(`YUV4MPEG2 W${W} H${H} F15:1 Ip A1:1 C420jpeg\n`);
  const frame = Buffer.from('FRAME\n');
  const parts: Buffer[] = [header];
  for (let i = 0; i < blank + shown; i++) parts.push(frame, i < blank ? grey : code, chroma);
  writeFileSync(path, Buffer.concat(parts));
}

test('the camera reads a real ticket QR and admits it, with either reader', async ({
  page,
  playwright,
  baseURL,
}) => {
  test.slow();
  await signInAsAdmin(page);
  const { id, slug } = await publishedEvent(page, `Camera ${Date.now()}`);
  const { codes } = await issuedOrder(page, slug, 'Sadia Rahman', 2);
  const gate = await newGatePass(page, `/admin/events/${id}/check-in`, 'Gate A');
  await openDoors(page, id);

  /** One phone, its camera playing `code`; `zxing`: the browser's own reader hidden (iPhone). */
  async function scan(code: string, zxing: boolean, countAfter: string) {
    const video = test.info().outputPath(`ticket-${zxing ? 'zxing' : 'native'}.y4m`);
    qrVideo(video, code);
    const browser = await playwright.chromium.launch({
      args: [
        '--use-fake-ui-for-media-stream',
        '--use-fake-device-for-media-stream',
        `--use-file-for-fake-video-capture=${video}`,
      ],
    });
    try {
      const context = await browser.newContext({
        baseURL,
        viewport: { width: 360, height: 780 },
        permissions: ['camera'],
      });
      if (zxing) {
        await context.addInitScript(() => {
          delete (globalThis as { BarcodeDetector?: unknown }).BarcodeDetector;
        });
      }
      const phone = await context.newPage();
      await phone.goto(`/door#code=${gate}`);
      if (zxing) {
        await phone.getByRole('button', { name: 'Start scanning' }).click();
      } else {
        // ADR-059: the pre-doors test, on real frames. The code in view is
        // not admitted while the test covers the viewfinder.
        await phone.getByRole('button', { name: 'Run pre-doors test' }).click();
        const selfTest = phone.getByTestId('door-selftest');
        for (const key of ['camera', 'speed', 'list', 'offline']) {
          await expect(selfTest.locator(`[data-check="${key}"]`)).toHaveAttribute(
            'data-level',
            'ok',
            { timeout: 15_000 },
          );
        }
        const sound = selfTest.locator('[data-check="sound"]');
        await expect(sound).toHaveAttribute('data-level', 'warn');
        await expect(selfTest).toHaveAttribute('data-ready', 'false');
        await expect(phone.getByTestId('door-count')).toHaveText('0 / 2 in');
        await sound.getByRole('button', { name: 'Test' }).click();
        await sound.getByRole('button', { name: 'Heard it' }).click();
        await expect(selfTest).toHaveAttribute('data-ready', 'true');
        await selfTest.getByRole('button', { name: 'Start scanning' }).click();
      }

      // One condition, polled as a whole: a green clears itself in 0.8 s.
      const admitted = phone.locator('[data-testid="door-result"][data-result="admitted"]', {
        hasText: 'Sadia Rahman',
      });
      await expect(admitted).toBeVisible({ timeout: 15_000 });
      await expect(phone.getByTestId('door-count')).toHaveText(countAfter);

      // The steady read time the pre-doors test shows, measured on real frames.
      const main = phone.locator('main[data-read-ms]');
      await expect(main).toHaveAttribute('data-decoder', zxing ? 'zxing' : /native|zxing/);
      await phone.waitForTimeout(3_000);
      const ms = Number(await main.getAttribute('data-read-ms'));
      const decoder = await main.getAttribute('data-decoder');
      test.info().annotations.push({ type: 'read speed', description: `${decoder}: ${ms} ms` });
      console.log(`read speed · ${decoder}: ${ms} ms`);
      expect(ms).toBeLessThan(150);
    } finally {
      await browser.close();
    }
  }

  await scan(codes[0]!, false, '1 / 2 in');
  await scan(codes[1]!, true, '2 / 2 in');
});
