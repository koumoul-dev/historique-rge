import { strict as assert } from 'node:assert'
import { describe, it } from 'node:test'
import { today, dayBefore } from '../lib/dates.ts'

describe('dates', () => {
  it('formats today in the Europe/Paris timezone', () => {
    // 23:30 UTC on 2026-09-21 is already 2026-09-22 in Paris (UTC+2 in September)
    assert.equal(today(new Date('2026-09-21T23:30:00Z')), '2026-09-22')
    assert.equal(today(new Date('2026-09-21T12:00:00Z')), '2026-09-21')
  })

  it('computes the day before, across month and year boundaries', () => {
    assert.equal(dayBefore('2026-09-21'), '2026-09-20')
    assert.equal(dayBefore('2026-03-01'), '2026-02-28')
    assert.equal(dayBefore('2026-01-01'), '2025-12-31')
  })
})
