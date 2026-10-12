// Renders the brand files from src/lib/brand (docs/BRAND.md):
// `pnpm brand:assets`. Run it after changing the mark or the wordmark.
//   src/app/favicon.ico              16, 32 and 48 px PNGs in one ICO container
//   public/brand/email-logo.png      the lockup on white, for email headers
//   docs-site/app/icon.svg           the favicon tile, for the docs site
//   docs-site/lib/brand.generated.ts the brand data, for the docs site's logo
import { mkdir, writeFile } from 'node:fs/promises';
import sharp from 'sharp';
import { EMAIL_LOGO } from '../../src/lib/brand/marks';
import { docsBrandModule, faviconSvg, lockupSvg } from '../../src/lib/brand/svg';

async function favicon(): Promise<void> {
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

async function emailLogo(): Promise<void> {
  const width = EMAIL_LOGO.width * EMAIL_LOGO.scale;
  const height = EMAIL_LOGO.height * EMAIL_LOGO.scale;
  // Drawn at 4x density, then downsampled, for smooth curves. White, not
  // transparent: dark-mode mail apps would put charcoal ink on charcoal.
  const svg = Buffer.from(lockupSvg({ width, height, background: '#ffffff' }));
  const png = await sharp(svg, { density: 72 * 4 })
    .resize(width, height)
    .flatten({ background: '#ffffff' })
    .png({ compressionLevel: 9, palette: true })
    .toBuffer();
  await mkdir('public/brand', { recursive: true });
  await writeFile(`public${EMAIL_LOGO.path}`, png);
  console.log(`email-logo.png: ${width}x${height} px, ${png.length} bytes`);
}

async function docsSite(): Promise<void> {
  await writeFile('docs-site/app/icon.svg', faviconSvg());
  await writeFile('docs-site/lib/brand.generated.ts', docsBrandModule());
  console.log('docs-site: app/icon.svg, lib/brand.generated.ts');
}

async function main(): Promise<void> {
  await Promise.all([favicon(), emailLogo(), docsSite()]);
}

main().catch((err: unknown) => {
  console.error(err);
  process.exitCode = 1;
});
