-- Run this in your Supabase project's SQL Editor
-- (Dashboard -> SQL Editor -> New query -> paste -> Run)
-- Safe to re-run: every statement below is idempotent.

create extension if not exists "pgcrypto";

-- ============ users (lead details, one row per signed-up user) ============

create table if not exists public.users (
  id uuid primary key references auth.users(id) on delete cascade,
  full_name text not null,
  phone text not null,
  created_at timestamptz not null default now()
);

alter table public.users enable row level security;

drop policy if exists "Users can view their own profile" on public.users;
create policy "Users can view their own profile"
  on public.users for select
  to authenticated
  using (id = auth.uid());

drop policy if exists "Users can insert their own profile" on public.users;
create policy "Users can insert their own profile"
  on public.users for insert
  to authenticated
  with check (id = auth.uid());

drop policy if exists "Users can update their own profile" on public.users;
create policy "Users can update their own profile"
  on public.users for update
  to authenticated
  using (id = auth.uid())
  with check (id = auth.uid());

-- ============ time_slots ============

create table if not exists public.time_slots (
  id uuid primary key default gen_random_uuid(),
  slot_date date not null,
  start_time time not null,
  end_time time not null,
  is_booked boolean not null default false,
  booked_by uuid references auth.users(id) on delete set null,
  booked_at timestamptz,
  google_event_id text,
  created_at timestamptz not null default now()
);

-- In case time_slots already existed from an earlier run of this script
alter table public.time_slots add column if not exists google_event_id text;

alter table public.time_slots enable row level security;

-- Any signed-in user can see all slots (booked or not)
drop policy if exists "Authenticated users can view slots" on public.time_slots;
create policy "Authenticated users can view slots"
  on public.time_slots for select
  to authenticated
  using (true);

-- Any signed-in user can book a slot that is currently open,
-- and can only claim it for themselves
drop policy if exists "Authenticated users can book an open slot" on public.time_slots;
create policy "Authenticated users can book an open slot"
  on public.time_slots for update
  to authenticated
  using (is_booked = false)
  with check (booked_by = auth.uid() and is_booked = true);

-- Users can cancel their own booking, freeing the slot back up
drop policy if exists "Users can cancel their own booking" on public.time_slots;
create policy "Users can cancel their own booking"
  on public.time_slots for update
  to authenticated
  using (booked_by = auth.uid())
  with check (booked_by is null and is_booked = false);

-- Booking now happens via the n8n workflow, which inserts a row here only
-- once a slot is actually booked (available slots are computed on the fly,
-- not pre-seeded) — so this table is no longer pre-filled with empty rows.

-- Guard against two people booking the same slot in a race: only one
-- *booked* row may exist per date/start/end combination.
create unique index if not exists time_slots_no_double_booking
  on public.time_slots (slot_date, start_time, end_time)
  where is_booked = true;
