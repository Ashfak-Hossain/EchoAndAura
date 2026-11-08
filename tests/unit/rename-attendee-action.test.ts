import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NAME_MAX } from '@/server/lib/attendee-name';

/**
 * The ticket page's rename form. Until L3b moves it to codes, the action
 * words its validation error itself; on `/` that must stay the English it
 * said before L3a. The service is mocked; what is under test is the wiring.
 */
const renameAttendee = vi.fn();
const revalidatePath = vi.fn();

vi.mock('next/cache', () => ({ revalidatePath }));
vi.mock('@/server/container', () => ({ ticketsService: { renameAttendee } }));
vi.mock('@/server/lib/logger', () => ({ logger: { error: vi.fn() } }));

const { renameAttendeeAction } = await import('@/app/(public)/tickets/[code]/actions');

function form(name: string): FormData {
  const f = new FormData();
  f.set('attendeeName', name);
  return f;
}

beforeEach(() => {
  renameAttendee.mockReset();
  revalidatePath.mockReset();
});

describe('rename attendee: validation', () => {
  it('an empty name asks for one, keeps the previous save, and calls no service', async () => {
    const prev = { saved: 'Rahim', savedAt: 1 };
    const state = await renameAttendeeAction('T-1', prev, form(''));
    expect(state).toEqual({ ...prev, error: 'Enter the name the guest will give at the door.' });
    expect(renameAttendee).not.toHaveBeenCalled();
  });

  it('a name over the limit says it is too long', async () => {
    const state = await renameAttendeeAction('T-1', {}, form('a'.repeat(NAME_MAX + 1)));
    expect(state.error).toBe('The name the guest will give at the door is too long.');
    expect(renameAttendee).not.toHaveBeenCalled();
  });

  it('a valid name is saved and the ticket page re-rendered', async () => {
    renameAttendee.mockResolvedValue({ attendeeName: 'Karim' });
    const state = await renameAttendeeAction('T-1', {}, form('Karim'));
    expect(state).toEqual({ saved: 'Karim', savedAt: expect.any(Number) });
    expect(renameAttendee).toHaveBeenCalledWith('T-1', 'Karim');
    expect(revalidatePath).toHaveBeenCalledWith('/tickets/T-1');
  });
});
