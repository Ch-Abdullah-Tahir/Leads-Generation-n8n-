export function bookingDate(now = new Date()) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Karachi', year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(now)
  const value = type => parts.find(part => part.type === type).value
  return `${value('year')}-${value('month')}-${value('day')}`
}

export function slotTime(slot, field) {
  return Date.parse(`${slot.slot_date}T${slot[field]}+05:00`)
}

export function hasStarted(slot, now = Date.now()) {
  return !(slotTime(slot, 'start_time') > now)
}

export function activeBookings(bookings, now = Date.now()) {
  return bookings.filter(slot => slot.is_booked && slotTime(slot, 'end_time') > now)
    .sort((a, b) => slotTime(a, 'start_time') - slotTime(b, 'start_time'))
}
