import { describe, it, expect } from 'vitest'
import { escapeHtml } from '../src/util/html.js'

describe('util/html escapeHtml', () => {
  it('escapes the HTML-significant characters', () => {
    expect(escapeHtml('<a href="x">tom & jerry</a>')).toBe(
      '&lt;a href=&quot;x&quot;&gt;tom &amp; jerry&lt;/a&gt;'
    )
  })

  it('escapes ampersands before the others (no double-escaping)', () => {
    expect(escapeHtml('&lt;')).toBe('&amp;lt;')
  })

  it('coerces non-string input to a string', () => {
    expect(escapeHtml(42)).toBe('42')
    expect(escapeHtml(null)).toBe('null')
    expect(escapeHtml(undefined)).toBe('undefined')
  })

  it('leaves plain text untouched', () => {
    expect(escapeHtml('hello world')).toBe('hello world')
  })
})
