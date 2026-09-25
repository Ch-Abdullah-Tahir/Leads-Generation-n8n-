import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import Navbar from '../components/Navbar'
import { supabase } from '../lib/supabaseClient'
import { bookingDate, hasStarted, activeBookings } from '../lib/bookingRules'

const SLOTS_WEBHOOK_URL = import.meta.env.VITE_SLOTS_WEBHOOK_URL
const BOOK_SLOT_WEBHOOK_URL = import.meta.env.VITE_BOOK_SLOT_WEBHOOK_URL
const CANCEL_SLOT_WEBHOOK_URL = import.meta.env.VITE_CANCEL_SLOT_WEBHOOK_URL
const REFRESH_INTERVAL_MS = 30_000

function todayDate() {
  return bookingDate()
}

// The webhook returns computed slots, not database rows, so there's no
// row id to key off — build a stable key from what does identify a slot.
function slotKey(slot) {
  return `${slot.slot_date}_${slot.start_time}_${slot.end_time}`
}

function formatTime(t) {
  const [h, m] = t.split(':')
  const hour = Number(h)
  const period = hour >= 12 ? 'PM' : 'AM'
  const hour12 = hour % 12 === 0 ? 12 : hour % 12
  return `${hour12}:${m} ${period}`
}

function formatDateHeading(dateStr) {
  const date = new Date(`${dateStr}T00:00:00`)
  return date.toLocaleDateString(undefined, {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
  })
}

export default function Home() {
  const { user, profile, profileLoading } = useAuth()
  const navigate = useNavigate()
  const [slots, setSlots] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [bookingKey, setBookingKey] = useState(null)
  const [toast, setToast] = useState('')
  const [bookingError, setBookingError] = useState('')
  const [selectedDate, setSelectedDate] = useState(todayDate)
  const [refreshCount, setRefreshCount] = useState(0)
  const [ownBookings, setOwnBookings] = useState([])
  const [ownLoading, setOwnLoading] = useState(true)
  const [ownError, setOwnError] = useState('')
  const [now, setNow] = useState(Date.now)
  const [refreshing, setRefreshing] = useState(false)
  const [lastUpdated, setLastUpdated] = useState(null)
  const loadedDate = useRef(null)
  const upcoming = activeBookings(ownBookings, now)
  const bookingBlocked = ownLoading || Boolean(ownError) || upcoming.length > 0

  const readOwnBookings = useCallback(async () => {
    const { data, error: queryError } = await supabase.from('time_slots')
      .select('id,slot_date,start_time,end_time,is_booked,booked_by')
      .eq('booked_by', user.id).eq('is_booked', true).gte('slot_date', todayDate())
      .abortSignal(AbortSignal.timeout(20000))
    if (queryError) throw new Error('Could not check your existing appointments. Please refresh and try again.')
    return data || []
  }, [user.id])

  useEffect(() => {
    let ignore = false
    async function load() {
      setOwnLoading(true)
      setOwnError('')
      try {
        const data = await readOwnBookings()
        if (!ignore) setOwnBookings(data)
      } catch (err) {
        if (!ignore) setOwnError(err.message)
      } finally {
        if (!ignore) setOwnLoading(false)
      }
    }
    load()
    return () => { ignore = true }
  }, [readOwnBookings, refreshCount])

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(timer)
  }, [])

  useEffect(() => {
    const refresh = () => {
      if (document.visibilityState !== 'visible' || !navigator.onLine ||
          bookingKey !== null || loading || ownLoading || refreshing || !profile) return
      setRefreshCount(count => count + 1)
    }
    const timer = setInterval(refresh, REFRESH_INTERVAL_MS)
    document.addEventListener('visibilitychange', refresh)
    window.addEventListener('focus', refresh)
    window.addEventListener('online', refresh)
    return () => {
      clearInterval(timer)
      document.removeEventListener('visibilitychange', refresh)
      window.removeEventListener('focus', refresh)
      window.removeEventListener('online', refresh)
    }
  }, [bookingKey, loading, ownLoading, refreshing, profile])

  useEffect(() => {
    if (!profileLoading && !profile) navigate('/complete-profile', { replace: true })
  }, [profileLoading, profile, navigate])

  useEffect(() => {
    const controller = new AbortController()
    let disposed = false
    const timeout = setTimeout(() => controller.abort(new Error('Availability refresh timed out. It will retry automatically.')), 20000)
    async function fetchSlots() {
      setRefreshing(true)
      if (loadedDate.current !== selectedDate) {
        setLoading(true)
        setSlots([])
      }
      try {
        if (!SLOTS_WEBHOOK_URL) throw new Error('Slot availability is not configured.')
        const url = new URL(SLOTS_WEBHOOK_URL)
        url.searchParams.set('date', selectedDate)
        const res = await fetch(url, { signal: controller.signal, cache: 'no-store' })
        if (!res.ok) throw new Error(`Workflow returned ${res.status}`)
        const data = await res.json()
        if (!Array.isArray(data)) throw new Error('Could not read slot availability.')
        if (data.some(slot => slot.slot_date !== selectedDate)) {
          throw new Error('Availability returned for a different date. Please try again later.')
        }
        if (!controller.signal.aborted) {
          setSlots(data)
          setError('')
          loadedDate.current = selectedDate
          setLastUpdated(Date.now())
        }
      } catch (err) {
        if (!disposed) setError(err.message)
      } finally {
        clearTimeout(timeout)
        if (!disposed) {
          setLoading(false)
          setRefreshing(false)
        }
      }
    }
    fetchSlots()
    return () => {
      disposed = true
      clearTimeout(timeout)
      controller.abort()
    }
  }, [selectedDate, refreshCount])

  useEffect(() => {
    if (!toast) return
    const timer = setTimeout(() => setToast(''), 3000)
    return () => clearTimeout(timer)
  }, [toast])

  const grouped = useMemo(() => {
    const map = new Map()
    for (const slot of slots) {
      if (!map.has(slot.slot_date)) map.set(slot.slot_date, [])
      map.get(slot.slot_date).push(slot)
    }
    return Array.from(map.entries())
  }, [slots])

  async function handleBook(slot) {
    if (bookingKey !== null || bookingBlocked) return
    setBookingKey(slotKey(slot))
    setBookingError('')
    try {
      if (hasStarted(slot)) throw new Error('That appointment time has already started.')
      const existing = await readOwnBookings()
      setOwnBookings(existing)
      if (activeBookings(existing).length) throw new Error('You already have an upcoming appointment. Cancel it or wait until it ends before booking again.')
      if (!BOOK_SLOT_WEBHOOK_URL) throw new Error('Booking endpoint is not configured.')
      const email = user.email?.trim()
      if (!email) throw new Error('Your account needs an email address to receive a meeting invitation.')
      const res = await fetch(BOOK_SLOT_WEBHOOK_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          slot_date: slot.slot_date,
          start_time: slot.start_time,
          end_time: slot.end_time,
          user_id: user.id,
          email,
          full_name: profile.full_name,
        }),
      })
      if (!res.ok) {
        const body = await res.json().catch(() => null)
        const detail = typeof body?.message === 'string' ? body.message
          : typeof body?.error === 'string' ? body.error : ''
        throw new Error(`Booking service returned HTTP ${res.status}${detail ? `: ${detail.slice(0, 400)}` : '. Check the failed n8n execution for details.'}`)
      }
      setToast(`Booked ${formatDateHeading(slot.slot_date)} at ${formatTime(slot.start_time)}`)
      setRefreshCount(count => count + 1)
    } catch (err) {
      setBookingError(`Could not confirm booking: ${err.message} Check your bookings before trying again.`)
      setOwnLoading(true)
      setRefreshCount(count => count + 1)
    }
    setBookingKey(null)
  }

  async function handleCancel(slot) {
    if (bookingKey !== null || slot.booked_by !== user.id) return
    if (!window.confirm(`Cancel your booking on ${formatDateHeading(slot.slot_date)} at ${formatTime(slot.start_time)}?`)) return
    setBookingKey(slotKey(slot))
    setBookingError('')
    try {
      if (!CANCEL_SLOT_WEBHOOK_URL) throw new Error('Cancellation endpoint is not configured.')
      const res = await fetch(CANCEL_SLOT_WEBHOOK_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          slot_date: slot.slot_date,
          start_time: slot.start_time,
          end_time: slot.end_time,
          user_id: user.id,
        }),
      })
      const body = await res.json().catch(() => null)
      if (!res.ok) {
        const detail = typeof body?.message === 'string' ? body.message : ''
        throw new Error(`Cancellation service returned HTTP ${res.status}${detail ? `: ${detail.slice(0, 400)}` : '. Check the failed n8n execution for details.'}`)
      }
      if (body?.success !== true) throw new Error('The cancellation service did not confirm success.')
      setToast(`Cancelled ${formatDateHeading(slot.slot_date)} at ${formatTime(slot.start_time)}`)
      setOwnLoading(true)
      setRefreshCount(count => count + 1)
    } catch (err) {
      setBookingError(`Could not confirm cancellation: ${err.message} Refresh availability before trying again.`)
    } finally {
      setBookingKey(null)
    }
  }

  if (profileLoading || !profile) {
    return (
      <div className="page-center">
        <div className="spinner" />
      </div>
    )
  }

  return (
    <div>
      <Navbar />
      <main className="home-main">
        <div className="home-header">
          <h1>Available time slots</h1>
          <p>Pick a slot that works for you. Your bookings stay reserved just for you.</p>
          <p>All appointment times are Pakistan time (UTC+5). One active appointment per account.</p>
          <p aria-live="polite">
            {refreshing ? 'Updating availability…' : 'Availability refreshes automatically every 30 seconds.'}
            {lastUpdated && !refreshing ? ` Last updated ${new Date(lastUpdated).toLocaleTimeString()}.` : ''}
          </p>
          <label className="field slot-date-picker">
            <span>Choose a date</span>
            <input
              type="date"
              value={selectedDate}
              min={todayDate()}
              required
              disabled={bookingKey !== null}
              onChange={event => {
                const date = event.target.value
                if (!date || date === selectedDate || !event.target.validity.valid || date < todayDate()) return
                setLoading(true)
                setSlots([])
                setError('')
                setSelectedDate(date)
              }}
            />
          </label>
        </div>

        {bookingError && <p className="form-error" role="alert">{bookingError}</p>}
        {ownError && <p className="form-error" role="alert">{ownError}</p>}
        {ownLoading && <p role="status">Checking your appointments…</p>}
        {!ownError && upcoming.length > 0 && (
          <section className="day-group" aria-label="Your upcoming appointments">
            <h2>Your upcoming appointment{upcoming.length > 1 ? 's' : ''}</h2>
            <p>You can book again after your appointment ends or is cancelled.</p>
            {upcoming.map(appointment => (
              <div className="slot-card slot-mine" key={appointment.id}>
                <span>{formatDateHeading(appointment.slot_date)} · {formatTime(appointment.start_time)}–{formatTime(appointment.end_time)}</span>
                <button className="btn btn-ghost btn-small" disabled={bookingKey !== null} onClick={() => handleCancel(appointment)}>
                  {bookingKey === slotKey(appointment) ? 'Cancelling…' : 'Cancel'}
                </button>
              </div>
            ))}
          </section>
        )}

        {loading && (
          <div className="page-center">
            <div className="spinner" />
          </div>
        )}

        {!loading && error && (
          <div className="empty-state">
            <p className="form-error">{error}</p>
          </div>
        )}

        {!loading && !error && grouped.length === 0 && (
          <div className="empty-state">
            <p>No available slots for {formatDateHeading(selectedDate)}. Please choose another date.</p>
          </div>
        )}

        {!loading &&
          !error &&
          grouped.map(([date, daySlots]) => (
            <section key={date} className="day-group">
              <h2>{formatDateHeading(date)}</h2>
              <div className="slot-grid">
                {daySlots.map((slot) => {
                  const isMine = slot.booked_by === user.id
                  const isBusy = bookingKey === slotKey(slot)
                  return (
                    <div
                      key={slotKey(slot)}
                      className={`slot-card ${slot.is_booked ? (isMine ? 'slot-mine' : 'slot-taken') : ''}`}
                    >
                      <span className="slot-time">
                        {formatTime(slot.start_time)} – {formatTime(slot.end_time)}
                      </span>
                      {slot.is_booked ? (
                        isMine ? (
                          <>
                            <span className="slot-status slot-status-mine">Your booking</span>
                            <button className="btn btn-ghost btn-small" disabled={bookingKey !== null} onClick={() => handleCancel(slot)}>
                              {isBusy ? 'Cancelling…' : 'Cancel'}
                            </button>
                          </>
                        ) : (
                          <span className="slot-status slot-status-taken">Booked</span>
                        )
                      ) : (
                        <button
                          className="btn btn-primary btn-small"
                          disabled={bookingKey !== null || bookingBlocked || hasStarted(slot, now)}
                          onClick={() => handleBook(slot)}
                        >
                          {isBusy ? 'Booking…' : hasStarted(slot, now) ? 'Unavailable' : upcoming.length ? 'Booking limit reached' : 'Select'}
                        </button>
                      )}
                    </div>
                  )
                })}
              </div>
            </section>
          ))}
      </main>

      {toast && <div className="toast">{toast}</div>}
    </div>
  )
}
