/**
 * Frontend unit tests — pure functions extracted from main.js.
 * Run with: bun test web/tests/unit.test.js
 */
import { describe, test, expect } from 'bun:test'

// ── Helpers copied verbatim from main.js ──────────────────────────────────

function escHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

function initials(address) {
  const name = address.split('@')[0] || '?'
  return name.slice(0, 2).toUpperCase()
}

function formatDate(iso, now = new Date()) {
  const d = new Date(iso)
  const isToday = d.toDateString() === now.toDateString()
  if (isToday) return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
  return d.toLocaleDateString([], { month: 'short', day: 'numeric' })
}

// ── escHtml ───────────────────────────────────────────────────────────────

describe('escHtml', () => {
  test('passes through plain text unchanged', () => {
    expect(escHtml('hello world')).toBe('hello world')
  })

  test('escapes ampersand', () => {
    expect(escHtml('foo & bar')).toBe('foo &amp; bar')
  })

  test('escapes less-than', () => {
    expect(escHtml('<script>')).toBe('&lt;script&gt;')
  })

  test('escapes greater-than', () => {
    expect(escHtml('1 > 0')).toBe('1 &gt; 0')
  })

  test('escapes double quotes', () => {
    expect(escHtml('"quoted"')).toBe('&quot;quoted&quot;')
  })

  test('escapes all special chars in one string', () => {
    expect(escHtml('<a href="x&y">Z</a>')).toBe('&lt;a href=&quot;x&amp;y&quot;&gt;Z&lt;/a&gt;')
  })

  test('coerces non-string to string', () => {
    expect(escHtml(42)).toBe('42')
    expect(escHtml(null)).toBe('null')
  })

  test('returns empty string for empty input', () => {
    expect(escHtml('')).toBe('')
  })
})

// ── initials ──────────────────────────────────────────────────────────────

describe('initials', () => {
  test('returns first two chars of local part, uppercased', () => {
    expect(initials('alice@example.com')).toBe('AL')
  })

  test('works for single-char local part', () => {
    expect(initials('a@x.com')).toBe('A')
  })

  test('handles no @ symbol (treats whole string as name)', () => {
    expect(initials('bob')).toBe('BO')
  })

  test('falls back to ? for empty local part', () => {
    expect(initials('@example.com')).toBe('?')
  })

  test('uppercases lowercase input', () => {
    expect(initials('charlie@d.com')).toBe('CH')
  })
})

// ── formatDate ────────────────────────────────────────────────────────────

describe('formatDate', () => {
  test('returns time string for today', () => {
    const now = new Date()
    const result = formatDate(now.toISOString(), now)
    // Should be a time like "2:30 PM" or "14:30"
    expect(result).toMatch(/\d/)
    expect(result).not.toMatch(/Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec/)
  })

  test('returns date string for a different day', () => {
    const yesterday = new Date()
    yesterday.setDate(yesterday.getDate() - 1)
    const result = formatDate(yesterday.toISOString(), new Date())
    // Should be like "Apr 11" — contains month abbreviation
    expect(result).toMatch(/Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec/)
  })

  test('handles ISO timestamp with time component', () => {
    const now = new Date()
    const iso = now.toISOString()
    const result = formatDate(iso, now)
    expect(typeof result).toBe('string')
    expect(result.length).toBeGreaterThan(0)
  })
})
