import { describe, expect, it } from 'vitest';
import { registrationFormSchema, registrationFormValues } from '@/lib/validation/orders';

const valid = {
  ticketTypeId: '7a1f2d3c-4b5e-4f60-8a9b-0c1d2e3f4a5b',
  quantity: '2',
  buyerName: '  Nusrat Jahan ',
  buyerEmail: ' Nusrat.Jahan@Gmail.com ',
  buyerPhone: '1712 345 678',
  attendeeNames: ['Nusrat Jahan', 'Tanvir Alam'],
  terms: 'on',
};

const messagesOf = (input: unknown) => {
  const r = registrationFormSchema.safeParse(input);
  return r.success ? [] : r.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`);
};

describe('registrationFormSchema', () => {
  it('normalises: trims names, lower-cases email, stores the phone as E.164', () => {
    const r = registrationFormSchema.parse(valid);
    expect(r.quantity).toBe(2);
    expect(r.buyerName).toBe('Nusrat Jahan');
    expect(r.buyerEmail).toBe('nusrat.jahan@gmail.com');
    expect(r.buyerPhone).toBe('+8801712345678');
  });

  it('accepts the number with a leading 0, 880 or +880 as people actually type it', () => {
    for (const raw of ['01712345678', '8801712345678', '+880 1712-345678', '+8801712345678']) {
      expect(registrationFormSchema.parse({ ...valid, buyerPhone: raw }).buyerPhone).toBe(
        '+8801712345678',
      );
    }
  });

  // Failure paths, with the design's wording.
  it('rejects each bad field with the mock-up message', () => {
    expect(messagesOf({ ...valid, buyerName: 'N' })).toContain('buyerName: Enter your full name.');
    expect(messagesOf({ ...valid, buyerEmail: 'nusrat.jahan@' })).toContain(
      'buyerEmail: Enter a complete email address.',
    );
    expect(messagesOf({ ...valid, buyerPhone: '17123' })).toContain(
      'buyerPhone: A bKash number is 10 digits after +880.',
    );
    expect(messagesOf({ ...valid, buyerPhone: '0171234567' })).toContain(
      'buyerPhone: A bKash number is 10 digits after +880.',
    );
    expect(messagesOf({ ...valid, terms: undefined })).toContain(
      'terms: Accept the terms to continue.',
    );
    expect(messagesOf({ ...valid, ticketTypeId: 'not-a-uuid' })).toContain(
      'ticketTypeId: Choose a ticket type.',
    );
  });

  it('bounds the quantity to 1–10 and refuses fractions', () => {
    expect(messagesOf({ ...valid, quantity: '0', attendeeNames: [] })).toContain(
      'quantity: At least 1 ticket.',
    );
    expect(messagesOf({ ...valid, quantity: '11' })).toContain('quantity: Max 10 per order.');
    expect(messagesOf({ ...valid, quantity: '1.5' })).toContain(
      'quantity: Choose how many tickets.',
    );
  });

  it('requires exactly one attendee name per ticket, each a real name', () => {
    expect(messagesOf({ ...valid, attendeeNames: ['Nusrat Jahan'] })).toContain(
      'attendeeNames: Enter a name for every ticket.',
    );
    expect(messagesOf({ ...valid, attendeeNames: ['Nusrat Jahan', ' '] })).toContain(
      'attendeeNames.1: Enter a name for every ticket.',
    );
  });

  it('never accepts a price from the body (unknown keys are stripped)', () => {
    const r = registrationFormSchema.parse({ ...valid, unitPricePaisa: 1, totalPaisa: 1 });
    expect(r).not.toHaveProperty('unitPricePaisa');
    expect(r).not.toHaveProperty('totalPaisa');
  });

  it('reads repeated attendeeNames keys from FormData', () => {
    const fd = new FormData();
    fd.set('ticketTypeId', valid.ticketTypeId);
    fd.set('quantity', '2');
    fd.append('attendeeNames', 'A B');
    fd.append('attendeeNames', 'C D');
    expect(registrationFormValues(fd)).toMatchObject({
      quantity: '2',
      attendeeNames: ['A B', 'C D'],
      terms: undefined,
    });
  });
});
