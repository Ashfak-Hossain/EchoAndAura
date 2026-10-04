import { describe, expect, it } from 'vitest';
import { normaliseDigits } from '@/server/lib/digits';
import {
  findOrderSchema,
  paymentFormSchema,
  registrationFormSchema,
} from '@/lib/validation/orders';
import { normalisePromoCode } from '@/server/lib/promo';
import { parseScanToken } from '@/server/lib/scan-token';
import { normaliseSearchTerm } from '@/lib/validation/orders-search';

describe('Bangla digits are digits (ADR-060)', () => {
  it('maps Bangla, Arabic-Indic and Persian digits to ASCII and leaves the rest alone', () => {
    expect(normaliseDigits('০১২৩৪৫৬৭৮৯')).toBe('0123456789');
    expect(normaliseDigits('٠١٢٣٤٥٦٧٨٩')).toBe('0123456789');
    expect(normaliseDigits('۰۱۲۳۴۵۶۷۸۹')).toBe('0123456789');
    expect(normaliseDigits('৯ab-১২ সন্ধ্যা')).toBe('9ab-12 সন্ধ্যা');
    expect(normaliseDigits('')).toBe('');
  });

  it('a bKash number typed on a Bangla keyboard is accepted and stored E.164', () => {
    const phone = '০১৭১২৩৪৫৬৭৮';
    expect(paymentFormSchema.parse({ trxId: '9AB12CD34E', senderPhone: phone }).senderPhone).toBe(
      '+8801712345678',
    );
    expect(findOrderSchema.parse({ reference: 'EA-7K3M9Q', phone }).phone).toBe('+8801712345678');
  });

  it('a TrxID in Bangla digits is stored as the same value as its ASCII form (Invariant 3)', () => {
    const bangla = paymentFormSchema.parse({ trxId: '৯ab১২cd৩৪e', senderPhone: '01712345678' });
    const ascii = paymentFormSchema.parse({ trxId: '9AB12CD34E', senderPhone: '01712345678' });
    expect(bangla.trxId).toBe(ascii.trxId);
  });

  it('quantity, promo codes, order references, ticket codes and the admin search', () => {
    const form = registrationFormSchema.safeParse({
      ticketTypeId: '6f1c2b8e-3a4d-4c5e-9f60-718293a4b5c6',
      quantity: '২',
      buyerName: 'Nusrat Jahan',
      buyerEmail: 'nusrat@example.com',
      buyerPhone: '১৭১২৩৪৫৬৭৮',
      terms: 'on',
    });
    expect(form.success && form.data.quantity).toBe(2);
    expect(normalisePromoCode('eid২০')).toBe('EID20');
    expect(findOrderSchema.parse({ reference: 'ea-৭k৩m৯q', phone: '01712345678' }).reference).toBe(
      'EA-7K3M9Q',
    );
    expect(parseScanToken('tkt-p৬৩dew২৬')).toBe('TKT-P63DEW26');
    expect(normaliseSearchTerm('০১৭১২৩৪৫৬৭৮').phone).toBe('+8801712345678');
  });
});
