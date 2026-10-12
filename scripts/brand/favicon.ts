// Renders src/app/favicon.ico from the brand data (docs/BRAND.md):
// `pnpm brand:favicon`. 16, 32 and 48 px PNGs in one ICO container.
import { writeFile } from 'node:fs/promises';
import sharp from 'sharp';
import { faviconSvg } from '../../src/lib/brand/svg';

async function main(): Promise<void> {
  const sizes = [16, 32, 48];
  const svg = Buffer.from(faviconSvg());
  const pngs = await Promise.all(
    sizes.map((size: number) =>
      sharp(svg, { density: 72 * (size / 100) * 8 })
        .resize(size, size)
        .png()
        .toBuffer(),
    ),
  );

  // ICO: a 6-byte header, one 16-byte entry per image, then the PNG data.
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(sizes.length, 4);
  let offset = 6 + 16 * sizes.length;
  const entries = pngs.map((png: Buffer, i: number) => {
    const entry = Buffer.alloc(16);
    entry.writeUInt8(sizes[i], 0);
    entry.writeUInt8(sizes[i], 1);
    entry.writeUInt8(0, 2);
    entry.writeUInt8(0, 3);
    entry.writeUInt16LE(1, 4);
    entry.writeUInt16LE(32, 6);
    entry.writeUInt32LE(png.length, 8);
    entry.writeUInt32LE(offset, 12);
    offset += png.length;
    return entry;
  });
  await writeFile('src/app/favicon.ico', Buffer.concat([header, ...entries, ...pngs]));
  console.log(`favicon.ico: ${sizes.join(', ')} px`);
}

main().catch((err: unknown) => {
  console.error(err);
  process.exitCode = 1;
});
