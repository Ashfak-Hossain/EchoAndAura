import { describe, expect, it } from 'vitest';
import {
  descriptionToHtml,
  descriptionToPlainText,
  looksLikeHtml,
  sanitizeDescriptionHtml,
} from '@/server/lib/description';

describe('sanitizeDescriptionHtml', () => {
  it('keeps the allowlisted formatting', () => {
    const html =
      '<h2>Line-up</h2><p><strong>Four</strong> acts, <em>one</em> night.</p>' +
      '<ul><li>Doors 18:30</li><li>Show 19:00</li></ul><blockquote>No support slots.</blockquote>';
    expect(sanitizeDescriptionHtml(html)).toBe(html);
  });

  it('strips scripts and their contents', () => {
    expect(sanitizeDescriptionHtml('<p>Hi</p><script>alert(1)</script>')).toBe('<p>Hi</p>');
  });

  it('strips event handlers and unknown tags but keeps their text', () => {
    expect(sanitizeDescriptionHtml('<p onclick="x()">Hi <span>there</span></p>')).toBe(
      '<p>Hi there</p>',
    );
    expect(sanitizeDescriptionHtml('<img src=x onerror=alert(1)><p>ok</p>')).toBe('<p>ok</p>');
  });

  it('drops javascript: links but keeps http(s) and mailto, hardened', () => {
    expect(sanitizeDescriptionHtml('<p><a href="javascript:alert(1)">x</a></p>')).toBe(
      '<p><a rel="noopener noreferrer" target="_blank">x</a></p>',
    );
    expect(sanitizeDescriptionHtml('<p><a href="https://a.com">x</a></p>')).toBe(
      '<p><a href="https://a.com" rel="noopener noreferrer" target="_blank">x</a></p>',
    );
    expect(sanitizeDescriptionHtml('<p><a href="mailto:hi@a.com">x</a></p>')).toContain(
      'href="mailto:hi@a.com"',
    );
  });

  it('normalises b/i/h1 to strong/em/h2', () => {
    expect(sanitizeDescriptionHtml('<h1>T</h1><p><b>a</b> <i>b</i></p>')).toBe(
      '<h2>T</h2><p><strong>a</strong> <em>b</em></p>',
    );
  });

  it('returns empty for an empty editor', () => {
    expect(sanitizeDescriptionHtml('<p></p>')).toBe('');
    expect(sanitizeDescriptionHtml('<p><br></p><p>&nbsp;</p>')).toBe('');
    expect(sanitizeDescriptionHtml('')).toBe('');
  });
});

describe('looksLikeHtml', () => {
  it('detects editor output vs legacy plain text', () => {
    expect(looksLikeHtml('<p>x</p>')).toBe(true);
    expect(looksLikeHtml('  <h2>x</h2>')).toBe(true);
    expect(looksLikeHtml('Four acts')).toBe(false);
    expect(looksLikeHtml('a < b and b > c')).toBe(false);
  });
});

describe('descriptionToHtml', () => {
  it('converts legacy plain text into escaped paragraphs', () => {
    expect(descriptionToHtml('Four acts.\n\nNo support <slots> & more.\nLine two')).toBe(
      '<p>Four acts.</p><p>No support &lt;slots&gt; &amp; more.<br>Line two</p>',
    );
  });

  it('passes editor HTML through the sanitiser', () => {
    expect(descriptionToHtml('<p>Hi</p><script>x</script>')).toBe('<p>Hi</p>');
  });

  it('returns null for nothing', () => {
    expect(descriptionToHtml(null)).toBeNull();
    expect(descriptionToHtml('')).toBeNull();
    expect(descriptionToHtml('<p></p>')).toBeNull();
    expect(descriptionToHtml('   \n\n  ')).toBeNull();
  });
});

describe('descriptionToPlainText', () => {
  it('flattens HTML for meta descriptions', () => {
    expect(
      descriptionToPlainText('<h2>Line-up</h2><p>Four <strong>acts</strong>,\none night.</p>'),
    ).toBe('Line-up Four acts, one night.');
  });

  it('decodes entities and collapses plain-text whitespace', () => {
    expect(descriptionToPlainText('<p>Tom &amp; Jerry</p>')).toBe('Tom & Jerry');
    expect(descriptionToPlainText('a\n\n  b')).toBe('a b');
    expect(descriptionToPlainText(null)).toBe('');
  });
});
