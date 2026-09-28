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

  it('names only the missing one when a single file is unreadable', () => {
    const readable = (file: string) => !file.endsWith('NotoSansBengali-Bold.ttf');
    expect(missingFontFiles(FONT_DIR, readable)).toEqual(['NotoSansBengali-Bold.ttf']);
  });
});
