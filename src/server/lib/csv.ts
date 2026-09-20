/**
 * RFC 4180 CSV for the admin exports (orders, check-in list). Pure: a
 * header and rows in, one string out. Every field is quoted when it holds
 * a comma, quote, CR or LF, or leading/trailing space; quotes are doubled.
 * Lines end in CRLF (what Excel expects). A UTF-8 BOM is prepended so
 * Excel on Windows reads Bangla names instead of mojibake.
 */
export type CsvValue = string | number | null | undefined;

export function csvField(value: CsvValue): string {
  if (value === null || value === undefined) return '';
  const s = String(value);
  // A leading = + - @ would be executed as a formula by spreadsheets when
  // the cell is untrusted user text (a buyer's name): neutralise it.
  const safe = /^[=+\-@]/.test(s) ? `'${s}` : s;
  return /[",\r\n]|^\s|\s$/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}

export function toCsv(header: readonly string[], rows: readonly (readonly CsvValue[])[]): string {
  const lines = [header, ...rows].map((r) => r.map(csvField).join(','));
  return `﻿${lines.join('\r\n')}\r\n`;
}
