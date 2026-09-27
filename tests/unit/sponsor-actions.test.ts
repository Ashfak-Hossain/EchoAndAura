import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  SponsorLogoInvalidError,
  SponsorNotFoundError,
  SponsorPresentingConflictError,
} from '@/server/lib/errors';

/**
 * B15 action wiring: the admin check comes first, bad input never reaches
 * the service, the actor is the session's email, the logo's bytes and type
 * reach the service as sent, and every domain refusal lands on the right
 * field with what was typed kept. The service is mocked.
 */
const requireAdmin = vi.fn();
const revalidatePath = vi.fn();
const create = vi.fn();
const update = vi.fn();
const setActive = vi.fn();
const setPosition = vi.fn();
const remove = vi.fn();

vi.mock('next/navigation', () => ({
  redirect: (url: string) => {
    throw new Error(`REDIRECT ${url}`);
  },
}));
vi.mock('next/cache', () => ({
  revalidatePath: (...args: unknown[]) => revalidatePath(...args),
}));
vi.mock('@/lib/session', () => ({ requireAdmin: () => requireAdmin() }));
vi.mock('@/server/container', () => ({
  sponsorsService: { create, update, setActive, setPosition, delete: remove },
}));

const { saveSponsorAction, setSponsorActiveAction, setSponsorPositionAction, deleteSponsorAction } =
  await import('@/app/admin/(protected)/sponsors/actions');

const ID = '0b1c2d3e-4f5a-4b6c-8d7e-9f0a1b2c3d4e';
const SVG = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 300 100"><rect/></svg>';

function form(extra: Record<string, string> = {}, logo: Blob | null = svgFile()): FormData {
  const f = new FormData();
  for (const [k, v] of Object.entries({
    name: 'Bhor FM',
    websiteUrl: 'https://bhor.example',
    level: 'supporter',
    tileTone: 'dark',
    active: 'on',
    position: '',
    actor: 'someone-else@example.com',
    ...extra,
  })) {
    f.set(k, v);
  }
  if (logo) f.set('logo', logo);
  return f;
}

function svgFile(): File {
  return new File([SVG], 'bhor.svg', { type: 'image/svg+xml' });
}

beforeEach(() => {
  requireAdmin.mockReset().mockResolvedValue({ email: 'raj@example.com', role: 'admin' });
  for (const fn of [revalidatePath, create, update, setActive, setPosition, remove]) fn.mockReset();
});

describe('saveSponsorAction', () => {
  it('a non-admin is sent away before anything is read or saved', async () => {
    requireAdmin.mockRejectedValue(new Error('REDIRECT /'));
    await expect(saveSponsorAction(null, {}, form())).rejects.toThrow('REDIRECT /');
    expect(create).not.toHaveBeenCalled();
  });

  it('creates as the signed-in admin with the logo as sent, then back to the list', async () => {
    create.mockResolvedValue({ id: ID, name: 'Bhor FM' });
    await expect(saveSponsorAction(null, {}, form())).rejects.toThrow(
      'REDIRECT /admin/sponsors?saved=Bhor%20FM',
    );
    expect(create).toHaveBeenCalledTimes(1);
    const [input, actor] = create.mock.calls[0] as [Record<string, unknown>, string];
    expect(actor).toBe('raj@example.com');
    expect(input).toMatchObject({
      name: 'Bhor FM',
      websiteUrl: 'https://bhor.example',
      level: 'supporter',
      tileTone: 'dark',
      active: true,
      position: undefined,
      logo: { contentType: 'image/svg+xml' },
    });
    const logo = input.logo as { bytes: Uint8Array };
    expect(new TextDecoder().decode(logo.bytes)).toBe(SVG);
    // The footer is on every public page: the whole tree is revalidated.
    expect(revalidatePath).toHaveBeenCalledWith('/', 'layout');
  });

  it('a new sponsor without a logo is refused on the logo field, input kept', async () => {
    const state = await saveSponsorAction(null, {}, form({}, null));
    expect(state).toMatchObject({ field: 'logo', values: { name: 'Bhor FM', tileTone: 'dark' } });
    expect(state.error).toBe('Upload the sponsor’s logo as an SVG or PNG.');
    expect(state.nonce).toBeTruthy();
    expect(create).not.toHaveBeenCalled();
  });

  it('editing without a new logo keeps the stored one', async () => {
    update.mockResolvedValue({ id: ID, name: 'Bhor FM' });
    await expect(saveSponsorAction(ID, {}, form({ position: '2' }, null))).rejects.toThrow(
      'REDIRECT /admin/sponsors?saved=Bhor%20FM',
    );
    const [id, input] = update.mock.calls[0] as [string, Record<string, unknown>];
    expect(id).toBe(ID);
    expect(input).toMatchObject({ position: 2, logo: undefined });
  });

  it('a missing name is refused inline and never reaches the service', async () => {
    const state = await saveSponsorAction(null, {}, form({ name: '  ' }));
    expect(state).toMatchObject({ field: 'name', values: { websiteUrl: 'https://bhor.example' } });
    expect(state.error).toContain('Enter the sponsor’s name');
    expect(create).not.toHaveBeenCalled();
  });

  it('an http:// website is refused on its field', async () => {
    const state = await saveSponsorAction(null, {}, form({ websiteUrl: 'http://bhor.example' }));
    expect(state.field).toBe('websiteUrl');
    expect(create).not.toHaveBeenCalled();
  });

  it('a bound id that is not a uuid never reaches the service', async () => {
    const state = await saveSponsorAction('../x', {}, form());
    expect(state.error).toBe('This sponsor no longer exists.');
    expect(update).not.toHaveBeenCalled();
  });

  it('a refused logo shows the screen’s own sentence on the logo field', async () => {
    const reason = 'The SVG contains a <script> element, which is not allowed in a logo.';
    create.mockRejectedValue(new SponsorLogoInvalidError(reason));
    const state = await saveSponsorAction(null, {}, form());
    expect(state).toMatchObject({ field: 'logo', error: reason, values: { name: 'Bhor FM' } });
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it('a presenting-partner clash asks for a reload, on the level', async () => {
    create.mockRejectedValue(new SponsorPresentingConflictError());
    const state = await saveSponsorAction(null, {}, form({ level: 'presenting' }));
    expect(state).toMatchObject({
      field: 'level',
      error: 'Someone else just changed the presenting partner — reload.',
    });
  });

  it('a sponsor deleted meanwhile says so', async () => {
    update.mockRejectedValue(new SponsorNotFoundError(ID));
    const state = await saveSponsorAction(ID, {}, form());
    expect(state.error).toBe('This sponsor no longer exists.');
    expect(state.field).toBeUndefined();
  });

  it('anything else is a calm retry message, not a crash', async () => {
    create.mockRejectedValue(new Error('connection reset'));
    const state = await saveSponsorAction(null, {}, form());
    expect(state.error).toBe('Could not save — nothing was changed. Please try again.');
  });
});

describe('row actions', () => {
  it('check the admin first, then pass the typed arguments as the admin', async () => {
    requireAdmin.mockRejectedValue(new Error('REDIRECT /admin/login'));
    await expect(setSponsorActiveAction(ID, false)).rejects.toThrow('REDIRECT');
    await expect(setSponsorPositionAction(ID, 2)).rejects.toThrow('REDIRECT');
    await expect(deleteSponsorAction(ID)).rejects.toThrow('REDIRECT');
    expect(setActive).not.toHaveBeenCalled();
    expect(setPosition).not.toHaveBeenCalled();
    expect(remove).not.toHaveBeenCalled();

    requireAdmin.mockResolvedValue({ email: 'raj@example.com', role: 'admin' });
    await expect(setSponsorActiveAction(ID, false)).resolves.toEqual({ ok: true });
    expect(setActive).toHaveBeenCalledWith(ID, false, 'raj@example.com');
    await expect(setSponsorPositionAction(ID, 2)).resolves.toEqual({ ok: true });
    expect(setPosition).toHaveBeenCalledWith(ID, 2, 'raj@example.com');
    await expect(deleteSponsorAction(ID)).resolves.toEqual({ ok: true });
    expect(remove).toHaveBeenCalledWith(ID, 'raj@example.com');
    expect(revalidatePath).toHaveBeenCalledTimes(3);
  });

  it('refuse a bad id or order before the service', async () => {
    expect(await setSponsorActiveAction('nope', true)).toEqual({
      ok: false,
      error: 'This sponsor no longer exists.',
    });
    const zero = await setSponsorPositionAction(ID, 0);
    expect(zero).toMatchObject({ ok: false, error: 'The display order is 1 to 999.' });
    const fraction = await setSponsorPositionAction(ID, 1.5);
    expect(fraction.ok).toBe(false);
    expect(await deleteSponsorAction('nope')).toMatchObject({ ok: false });
    expect(setActive).not.toHaveBeenCalled();
    expect(setPosition).not.toHaveBeenCalled();
    expect(remove).not.toHaveBeenCalled();
  });

  it('say so when the sponsor is gone', async () => {
    setActive.mockRejectedValue(new SponsorNotFoundError(ID));
    setPosition.mockRejectedValue(new SponsorNotFoundError(ID));
    remove.mockRejectedValue(new SponsorNotFoundError(ID));
    for (const r of [
      await setSponsorActiveAction(ID, true),
      await setSponsorPositionAction(ID, 1),
      await deleteSponsorAction(ID),
    ]) {
      expect(r).toEqual({ ok: false, error: 'This sponsor no longer exists.' });
    }
    expect(revalidatePath).not.toHaveBeenCalled();
  });
});
