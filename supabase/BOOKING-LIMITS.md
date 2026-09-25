# Enable booking limits

Run `booking-limits.sql` in the Supabase SQL Editor after `schema.sql`.
The file is a transaction and can be rerun. It does not delete existing bookings.
It has not been executed against the hosted database by the app changes.

Keep the n8n booking order: Save booking → Create meeting → Save calendar
event ID → Booking successful. Keep Save booking's error behavior set to stop.
The database trigger rejects a second active booking before Calendar creation.
No new n8n node is required. Do not place Calendar creation before the insert.

The rule lasts until the existing appointment's end time in Asia/Karachi.
Cancellation via deleting the row or setting is_booked=false releases its guard.
An atomic per-user guard prevents simultaneous inserts from taking two slots.
The existing unique index still prevents duplicate reservations of an exact slot.
Existing multiple bookings are retained and block additional bookings until all
have ended or been cancelled. Calendar-ID-only updates remain allowed.

Verify after installation using test accounts and future slots:

1. Reserve one slot; verify a second slot on another date is rejected.
2. Send two concurrent bookings for the same user; only one should insert.
3. Cancel the successful booking; a new future booking should be allowed.
4. Try a slot that already started today; the insert should be rejected.
5. Verify saving google_event_id on the successful row still works.

The frontend reads the user's reservations directly from Supabase, checks again
before booking, refreshes on window focus and actions, and uses a local clock
to expire restrictions. This is not yet a Supabase Realtime subscription.

Limits apply to submitted user IDs. The prototype webhook still needs server-side
token verification before public use. Calendar failures can still leave a
reservation; reconciliation/status handling is separate from this rule.
