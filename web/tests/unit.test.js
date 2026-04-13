/**
 * Frontend unit tests — pure functions extracted from components.
 * Run with: bun test web/tests/unit.test.js
 */
import { describe, test, expect } from 'bun:test'

// ── Helpers copied verbatim from components ───────────────────────────────

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
