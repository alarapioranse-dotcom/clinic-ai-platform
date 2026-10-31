import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { format, formatParts, placeholdersOf } from '@/i18n/format';

describe('format', () => {
  it('fills named placeholders, keeping all other text exactly', () => {
    expect(format('بدأت في {date}', { date: '١/٢/٢٠٢٦' })).toBe('بدأت في ١/٢/٢٠٢٦');
    expect(format('{role} · تنتهي {date}', { role: 'مسؤول', date: 'x' })).toBe('مسؤول · تنتهي x');
    expect(format('{min} و{max}', { min: 12, max: 128 })).toBe('12 و128');
  });

  it('leaves a placeholder with no value visible', () => {
    expect(format('a {missing} b', {})).toBe('a {missing} b');
    expect(format('a {toString} b', {})).toBe('a {toString} b');
  });
});

describe('formatParts', () => {
  it('places elements where their placeholders are', () => {
    const html = renderToStaticMarkup(
      <p>{formatParts('من {from} إلى {to}.', { from: <b>A</b>, to: <i>B</i> })}</p>,
    );
    expect(html).toBe('<p>من <b>A</b> إلى <i>B</i>.</p>');
  });
});

describe('placeholdersOf', () => {
  it('lists placeholders in order', () => {
    expect(placeholdersOf('{a} x {b} {a}')).toEqual(['a', 'b', 'a']);
    expect(placeholdersOf('none')).toEqual([]);
  });
});
