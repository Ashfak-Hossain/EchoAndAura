import { describe, expect, it } from 'vitest';
import { TICKET_TYPE_MAX_QUANTITY, ticketTypeFormSchema } from '@/lib/validation/ticket-types';

const valid = {
  name: '  General Admission ',
  priceTaka: '800',
  quantityTotal: '400',
  salesStartsAt: '',
  salesEndsAt: '',
};

function firstMessage(input: Record<string, string>): string | undefined {
  const r = ticketTypeFormSchema.safeParse(input);
  return r.success ? undefined : r.error.issues[0]?.message;
}

describe('ticketTypeFormSchema', () => {
  it('converts taka to integer paisa and trims the name', () => {
    const r = ticketTypeFormSchema.safeParse(valid);
    expect(r.success).toBe(true);
    if (!r.success) return;
    expect(r.data.name).toBe('General Admission');
    expect(r.data.pricePaisa).toBe(80_000);
    expect(r.data.quantityTotal).toBe(400);
    expect(r.data.salesStartsAt).toBeUndefined();
    expect('priceTaka' in r.data).toBe(false);
  });

  it('handles two-decimal prices exactly (799.50 → 79950, 0.01 → 1)', () => {
    expect(ticketTypeFormSchema.safeParse({ ...valid, priceTaka: '799.50' }).data?.pricePaisa).toBe(
      79_950,
    );
    expect(ticketTypeFormSchema.safeParse({ ...valid, priceTaka: '0.01' }).data?.pricePaisa).toBe(1);
    expect(ticketTypeFormSchema.safeParse({ ...valid, priceTaka: '0' }).data?.pricePaisa).toBe(0);
  });

  it('parses an optional sales window as Dhaka time', () => {
    const r = ticketTypeFormSchema.safeParse({
      ...valid,
      salesStartsAt: '2026-09-01T00:00',
      salesEndsAt: '2026-09-15T23:59',
    });
    expect(r.success).toBe(true);
    if (!r.success) return;
    expect(r.data.salesStartsAt?.toISOString()).toBe('2026-08-31T18:00:00.000Z');
  });

  // Failure paths — money and capacity inputs must be rejected, never coerced.
  it('rejects prices that are not taka with at most two decimals', () => {
    for (const priceTaka of ['1.999', '-5', 'abc', '', '1,000', '৳800']) {
      expect(firstMessage({ ...valid, priceTaka })).toMatch(/price/i);
    }
  });

  it('rejects quantities that are zero, fractional, negative, or too large', () => {
    for (const quantityTotal of ['0', '1.5', '-1', 'ten', '']) {
      expect(firstMessage({ ...valid, quantityTotal })).toMatch(/quantity|whole number/i);
    }
    expect(firstMessage({ ...valid, quantityTotal: String(TICKET_TYPE_MAX_QUANTITY + 1) })).toMatch(
      /at most/i,
    );
  });

  it('rejects a blank name', () => {
    expect(firstMessage({ ...valid, name: '  ' })).toBe('Name is required');
  });

  it('rejects a sales window that ends before it starts', () => {
    expect(
      firstMessage({
        ...valid,
        salesStartsAt: '2026-09-15T00:00',
        salesEndsAt: '2026-09-01T00:00',
      }),
    ).toBe('Sales must end after they start');
  });
});
