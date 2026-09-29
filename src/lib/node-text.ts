import { isValidElement, type ReactNode } from 'react';

/**
 * The readable text of static JSX, e.g. an FAQ answer, for structured data
 * (ADR-042). It walks elements' children rather than rendering, because
 * Server Components can't import react-dom/server. It is enough for content
 * made of text and simple wrappers (<p>, <strong>, <Link>): each element's
 * children are read, and block elements become spaces.
 */
const BLOCK = new Set(['p', 'div', 'li', 'ul', 'ol', 'h1', 'h2', 'h3', 'h4', 'br']);

export function nodeText(node: ReactNode): string {
  return collapse(walk(node));
}

function walk(node: ReactNode): string {
  if (node === null || node === undefined || typeof node === 'boolean') return '';
  if (typeof node === 'string' || typeof node === 'number') return String(node);
  if (Array.isArray(node)) return node.map(walk).join('');
  if (isValidElement<{ children?: ReactNode }>(node)) {
    const inner = walk(node.props.children);
    // Block elements end with a space so "<p>A</p><p>B</p>" reads "A B";
    // inline ones (<strong>, <a>, <Link>) run on with the sentence.
    return typeof node.type === 'string' && BLOCK.has(node.type) ? `${inner} ` : inner;
  }
  return '';
}

function collapse(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}
