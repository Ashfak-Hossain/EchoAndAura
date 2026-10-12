'use client';

import { Minus, Plus } from 'lucide-react';
import { useState } from 'react';

/**
 * Floating taka next to integer paisa, for one order and for a thousand of
 * them. An illustration of the app's rules (money.ts, promo.ts, pricing.ts),
 * not their code: the page shows the real functions as source excerpts.
 */
const PRICES = [
  { taka: 1200, label: '৳1,200' },
  { taka: 19.99, label: '৳19.99' },
  { taka: 333.33, label: '৳333.33' },
];
const PROMO_PERCENT = 15;
const ORDERS = 1000;

/** A float that is a whole number of paisa prints with at most 2 decimals. */
function isWholePaisa(taka: number): boolean {
  return Number.isFinite(taka) && !/\.\d{3,}/.test(String(taka));
}

function formatPaisa(paisa: number): string {
  const taka = Math.floor(paisa / 100).toLocaleString('en-US');
  return `৳${taka}.${String(paisa % 100).padStart(2, '0')}`;
}

function Float({ value }: { value: number }) {
  const whole = isWholePaisa(value);
  return (
    <td data-label="Floating taka">
      <code>{String(value)}</code>
      {whole ? null : <span className="paisa-flag">not a whole paisa</span>}
    </td>
  );
}

function Paisa({ value }: { value: number }) {
  return (
    <td data-label="Integer paisa">
      <code>{value.toLocaleString('en-US')}</code>{' '}
      <span className="paisa-taka">{formatPaisa(value)}</span>
    </td>
  );
}

export function PaisaCalculator() {
  const [price, setPrice] = useState(PRICES[1]);
  const [quantity, setQuantity] = useState(3);
  const [promo, setPromo] = useState(true);
  const pct = promo ? PROMO_PERCENT : 0;

  // Floating taka: what the app avoids.
  const floatSubtotal = price.taka * quantity;
  const floatDiscount = ((price.taka * pct) / 100) * quantity;
  const floatTotal = floatSubtotal - floatDiscount;
  let floatThousand = 0;
  for (let i = 0; i < ORDERS; i++) floatThousand += floatTotal;

  // Integer paisa: what the app stores. Converted once, rounded to the
  // nearest paisa; a percentage comes off each ticket, rounded down.
  const unitPaisa = Math.round(price.taka * 100);
  const subtotal = unitPaisa * quantity;
  const discount = Math.floor((unitPaisa * pct) / 100) * quantity;
  const total = subtotal - discount;

  return (
    <div className="paisa-calc">
      <p className="eyebrow">Illustration · same order, two ways to count</p>
      <div className="paisa-controls">
        <div role="group" aria-label="Ticket price">
          <span>Ticket price</span>
          {PRICES.map((p) => (
            <button
              key={p.label}
              type="button"
              aria-pressed={p === price}
              onClick={() => setPrice(p)}
            >
              {p.label}
            </button>
          ))}
        </div>
        <div role="group" aria-label="Quantity">
          <span>Tickets</span>
          <button
            type="button"
            aria-label="One ticket fewer"
            disabled={quantity <= 1}
            onClick={() => setQuantity((q) => q - 1)}
          >
            <Minus aria-hidden size={14} />
          </button>
          <output aria-live="polite">{quantity}</output>
          <button
            type="button"
            aria-label="One ticket more"
            disabled={quantity >= 10}
            onClick={() => setQuantity((q) => q + 1)}
          >
            <Plus aria-hidden size={14} />
          </button>
        </div>
        <div role="group" aria-label="Promo code">
          <button type="button" aria-pressed={promo} onClick={() => setPromo((v) => !v)}>
            DHAKA15 ({PROMO_PERCENT}% off)
          </button>
        </div>
      </div>
      <div className="paisa-table">
        <table>
          <caption className="sr-only">
            The order counted in floating taka and in integer paisa
          </caption>
          <thead>
            <tr>
              <th scope="col">Line</th>
              <th scope="col">Floating taka</th>
              <th scope="col">Integer paisa</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <th scope="row">Subtotal</th>
              <Float value={floatSubtotal} />
              <Paisa value={subtotal} />
            </tr>
            <tr>
              <th scope="row">Discount</th>
              <Float value={floatDiscount} />
              <Paisa value={discount} />
            </tr>
            <tr>
              <th scope="row">Total</th>
              <Float value={floatTotal} />
              <Paisa value={total} />
            </tr>
            <tr>
              <th scope="row">{ORDERS.toLocaleString('en-US')} such orders</th>
              <Float value={floatThousand} />
              <Paisa value={total * ORDERS} />
            </tr>
          </tbody>
        </table>
      </div>
      <p className="simulation-note">
        The floating column is plain JavaScript arithmetic on taka. The paisa column follows the
        app&apos;s rules: one conversion to whole paisa, then whole-number arithmetic only, with a
        percentage discount rounded down on each ticket.
      </p>
    </div>
  );
}
