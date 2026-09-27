import { describe, expect, it } from 'vitest';
import { SPONSOR_LOGO_MAX_BYTES } from '@/server/lib/sponsor-logo';
import {
  LOGO_FILE_ERRORS,
  checkLogoFile,
  sponsorActiveSchema,
  sponsorFormSchema,
  sponsorFormValues,
  sponsorIdSchema,
  sponsorPositionSchema,
} from '@/lib/validation/sponsors';

/** B15 form: what the admin can type, and the first gate on the logo file. */

const ID = '3f1c2b8e-6d4a-4f7e-9a51-0b2c4d6e8f10';

function form(over: Record<string, unknown> = {}) {
  return sponsorFormSchema.safeParse({
    name: 'Kolorob Audio',
    websiteUrl: '',
    level: 'partner',
    tileTone: 'light',
    active: true,
    position: '',
    ...over,
  });
}

function firstError(result: ReturnType<typeof form>): string | undefined {
  return result.success ? undefined : result.error.issues[0]?.message;
}

describe('sponsorFormSchema', () => {
  it('trims the name and stores a blank website as NULL', () => {
    const r = form({ name: '  Kolorob Audio  ', websiteUrl: '   ' });
    expect(r.success && r.data).toEqual({
      name: 'Kolorob Audio',
      websiteUrl: null,
      level: 'partner',
      tileTone: 'light',
      active: true,
      position: undefined,
    });
  });

  it('requires a name — it is the logo’s accessible label — and caps it', () => {
    expect(firstError(form({ name: '   ' }))).toBe(
      'Enter the sponsor’s name. It is read out by screen readers.',
    );
    expect(firstError(form({ name: undefined }))).toBe(
      'Enter the sponsor’s name. It is read out by screen readers.',
    );
    expect(form({ name: 'x'.repeat(80) }).success).toBe(true);
    expect(firstError(form({ name: 'x'.repeat(81) }))).toBe('Keep the name to 80 characters.');
  });

  it('accepts only a full https website link', () => {
    const ok = form({ websiteUrl: ' https://kolorob.example/about ' });
    expect(ok.success && ok.data.websiteUrl).toBe('https://kolorob.example/about');
    for (const bad of ['http://kolorob.example', 'kolorob.example', 'javascript:alert(1)']) {
      expect(firstError(form({ websiteUrl: bad }))).toBe(
        'Enter the full https:// link to their website.',
      );
    }
    expect(firstError(form({ websiteUrl: `https://a.example/${'x'.repeat(500)}` }))).toBe(
      'That link is too long.',
    );
  });

  it('knows the levels and tile tones', () => {
    for (const level of ['presenting', 'partner', 'supporter']) {
      expect(form({ level }).success).toBe(true);
    }
    expect(firstError(form({ level: 'gold' }))).toBe(
      'Choose Presenting partner, Partner or Supporter.',
    );
    expect(form({ tileTone: 'dark' }).success).toBe(true);
    expect(firstError(form({ tileTone: 'grey' }))).toBe('Choose a Light or Dark tile.');
  });

  it('reads the display order as a whole number 1–999; blank means unchanged', () => {
    const three = form({ position: ' 3 ' });
    expect(three.success && three.data.position).toBe(3);
    for (const bad of ['0', '1000', '-2']) {
      expect(firstError(form({ position: bad }))).toBe('The display order is 1 to 999.');
    }
    for (const bad of ['1.5', 'first']) {
      expect(firstError(form({ position: bad }))).toBe(
        'Enter the display order as a whole number.',
      );
    }
  });

  it('sponsorFormValues maps FormData, with the Active checkbox as a boolean', () => {
    const fd = new FormData();
    fd.set('name', 'Nodi Coffee');
    fd.set('websiteUrl', 'https://nodi.example');
    fd.set('level', 'supporter');
    fd.set('tileTone', 'dark');
    fd.set('position', '2');
    fd.set('logo', new File(['<svg/>'], 'logo.svg', { type: 'image/svg+xml' }));
    expect(sponsorFormValues(fd)).toEqual({
      name: 'Nodi Coffee',
      websiteUrl: 'https://nodi.example',
      level: 'supporter',
      tileTone: 'dark',
      active: false,
      position: '2',
    });
    fd.set('active', 'on');
    const r = sponsorFormSchema.safeParse(sponsorFormValues(fd));
    expect(r.success && r.data).toMatchObject({ active: true, position: 2, tileTone: 'dark' });
  });
});

describe('checkLogoFile', () => {
  const svg = (name = 'logo.svg', type = 'image/svg+xml') =>
    new File(['<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1 1"/>'], name, { type });

  it('accepts an SVG or PNG and says which type to hand the service', () => {
    const r = checkLogoFile(svg(), { required: true });
    expect(r).toMatchObject({ ok: true, contentType: 'image/svg+xml' });
    const png = new File([new Uint8Array(100)], 'logo.png', { type: 'image/png' });
    expect(checkLogoFile(png, { required: true })).toMatchObject({
      ok: true,
      contentType: 'image/png',
    });
    // Parameters and case are dropped; a missing type falls back to the extension.
    expect(
      checkLogoFile(svg('a.svg', 'Image/SVG+XML; charset=utf-8'), { required: true }),
    ).toMatchObject({ ok: true, contentType: 'image/svg+xml' });
    expect(checkLogoFile(svg('Logo.SVG', ''), { required: true })).toMatchObject({
      ok: true,
      contentType: 'image/svg+xml',
    });
  });

  it('no file chosen: fine on edit, an error on a new sponsor', () => {
    // A blank file input submits a nameless, empty file.
    const blank = new File([], '', { type: 'application/octet-stream' });
    for (const none of [null, undefined, '', blank]) {
      expect(checkLogoFile(none, { required: false })).toEqual({ ok: true, file: null });
      expect(checkLogoFile(none, { required: true })).toEqual({
        ok: false,
        error: LOGO_FILE_ERRORS.required,
      });
    }
  });

  it('refuses a non-file, an empty file, an oversized one and other types', () => {
    expect(checkLogoFile('logo.svg', { required: false })).toEqual({
      ok: false,
      error: LOGO_FILE_ERRORS.notFile,
    });
    expect(checkLogoFile(new File([], 'logo.svg'), { required: false })).toEqual({
      ok: false,
      error: LOGO_FILE_ERRORS.empty,
    });
    const big = new File([new Uint8Array(SPONSOR_LOGO_MAX_BYTES + 1)], 'logo.png', {
      type: 'image/png',
    });
    expect(checkLogoFile(big, { required: false })).toEqual({
      ok: false,
      error: LOGO_FILE_ERRORS.size,
    });
    const atLimit = new File([new Uint8Array(SPONSOR_LOGO_MAX_BYTES)], 'logo.png', {
      type: 'image/png',
    });
    expect(checkLogoFile(atLimit, { required: false }).ok).toBe(true);
    for (const [name, type] of [
      ['logo.jpg', 'image/jpeg'],
      ['logo.svgz', ''],
      ['logo.png', 'text/html'],
    ] as const) {
      expect(checkLogoFile(svg(name, type), { required: false })).toEqual({
        ok: false,
        error: LOGO_FILE_ERRORS.type,
      });
    }
  });
});

describe('row control schemas', () => {
  it('take a UUID, a whole-number position and a boolean', () => {
    expect(sponsorIdSchema.safeParse(ID).success).toBe(true);
    expect(sponsorIdSchema.safeParse('../etc').success).toBe(false);
    expect(sponsorPositionSchema.safeParse({ id: ID, position: 2 }).success).toBe(true);
    expect(sponsorPositionSchema.safeParse({ id: ID, position: 1.5 }).success).toBe(false);
    expect(sponsorPositionSchema.safeParse({ id: ID, position: 0 }).success).toBe(false);
    expect(sponsorActiveSchema.safeParse({ id: ID, active: false }).success).toBe(true);
    expect(sponsorActiveSchema.safeParse({ id: ID, active: 'on' }).success).toBe(false);
  });
});
