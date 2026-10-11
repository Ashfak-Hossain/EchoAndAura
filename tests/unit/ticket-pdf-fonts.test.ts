import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { FONT_DIR, missingFontFiles } from '@/server/pdf/ticket-pdf';

describe('missingFontFiles (the worker checks it at boot, 2026-09-28)', () => {
  it('finds all four fonts in the repo', () => {
    expect(FONT_DIR.endsWith(path.join('src', 'server', 'pdf', 'fonts'))).toBe(true);
    expect(missingFontFiles()).toEqual([]);
  });

  it('names every font a folder is missing (the worker image without them)', () => {
    expect(missingFontFiles('/nowhere/fonts')).toEqual([
      'NotoSans-Regular.ttf',
      'NotoSans-Bold.ttf',
      'NotoSansBengali-Regular.ttf',
      'NotoSansBengali-Bold.ttf',
    ]);
  });

  it('keeps the web image to traced files (Next 16.4 traced the whole repo, 2026-10-12)', () => {
    const source = readFileSync('src/server/pdf/ticket-pdf.tsx', 'utf8');
    expect(source).toContain('path.join(/*turbopackIgnore: true*/ dir, name)');
    const dockerfile = readFileSync('Dockerfile', 'utf8');
    expect(dockerfile).toContain('Next traced unexpected files into the server image');
    expect(dockerfile).toContain("! -path '*/src/server/pdf/fonts/*'");
  });

  it('names only the missing one when a single file is unreadable', () => {
    const readable = (file: string) => !file.endsWith('NotoSansBengali-Bold.ttf');
    expect(missingFontFiles(FONT_DIR, readable)).toEqual(['NotoSansBengali-Bold.ttf']);
  });
});
