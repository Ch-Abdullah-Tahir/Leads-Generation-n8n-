import test from 'node:test'
import assert from 'node:assert/strict'
import { bookingDate, hasStarted, activeBookings } from './bookingRules.js'

const slot = { slot_date: '2026-10-01', start_time: '13:30:00', end_time: '14:00:00', is_booked: true }
test('uses Pakistan date even when UTC is still the previous day', () => {
  assert.equal(bookingDate(new Date('2026-09-30T20:00:00Z')), '2026-10-01')
})
test('blocks a slot exactly at its start, including HH:mm values', () => {
  assert.equal(hasStarted(slot, Date.parse('2026-10-01T08:29:59Z')), false)
  assert.equal(hasStarted(slot, Date.parse('2026-10-01T08:30:00Z')), true)
  assert.equal(hasStarted({ ...slot, start_time: '13:30' }, Date.parse('2026-10-01T08:30:00Z')), true)
})
test('retains in-progress appointments and releases at end', () => {
  assert.equal(activeBookings([slot], Date.parse('2026-10-01T08:45:00Z')).length, 1)
  assert.equal(activeBookings([slot], Date.parse('2026-10-01T09:00:00Z')).length, 0)
})
test('includes other future dates, excludes cancellations, preserves legacy duplicates', () => {
  const tomorrow = { ...slot, slot_date: '2026-10-02' }
  assert.deepEqual(activeBookings([tomorrow, { ...slot, is_booked: false }, slot], Date.parse('2026-10-01T08:00:00Z')), [slot, tomorrow])
})
