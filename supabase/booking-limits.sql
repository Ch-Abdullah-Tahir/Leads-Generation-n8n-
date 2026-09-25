-- Run AFTER schema.sql in the Supabase SQL Editor.
-- Existing reservations are preserved. All times use Asia/Karachi.
begin;

-- Serialize competing reservations through a unique per-user record.
create table if not exists public.booking_user_guards (
  user_id uuid primary key references auth.users(id) on delete cascade,
  booking_id uuid not null,
  expires_at timestamptz not null
);
alter table public.booking_user_guards enable row level security;
revoke all on public.booking_user_guards from anon, authenticated;

create or replace function public.enforce_booking_limits()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  starts_at timestamptz;
  ends_at timestamptz;
  claimed uuid;
begin
  if not new.is_booked then return new; end if;
  if tg_op = 'UPDATE' then
    -- Calendar ID updates must remain possible, including on legacy bookings.
    if old.is_booked and new.booked_by is not distinct from old.booked_by
      and new.slot_date = old.slot_date and new.start_time = old.start_time
      and new.end_time = old.end_time then
      return new;
    end if;
  end if;

  starts_at := (new.slot_date + new.start_time) at time zone 'Asia/Karachi';
  ends_at := (new.slot_date + new.end_time) at time zone 'Asia/Karachi';
  if new.booked_by is null or ends_at <= starts_at then
    raise exception 'A booking requires a user and a valid time range';
  end if;
  if starts_at <= clock_timestamp() then
    raise exception 'Cannot book a slot that has already started';
  end if;

  insert into public.booking_user_guards as guard (user_id, booking_id, expires_at)
  values (new.booked_by, new.id, ends_at)
  on conflict (user_id) do update
    set booking_id = excluded.booking_id, expires_at = excluded.expires_at
    where guard.expires_at <= clock_timestamp() or guard.booking_id = new.id
  returning booking_id into claimed;
  if claimed is null then
    raise exception 'You already have an upcoming appointment';
  end if;

  -- Also covers reservations made before this migration.
  if exists (
    select 1 from public.time_slots s
    where s.booked_by = new.booked_by and s.is_booked and s.id <> new.id
      and (s.slot_date + s.end_time) at time zone 'Asia/Karachi' > clock_timestamp()
  ) then
    raise exception 'You already have an upcoming appointment';
  end if;
  return new;
end;
$$;

create or replace function public.release_booking_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    delete from public.booking_user_guards where booking_id = old.id;
    return old;
  end if;
  if not new.is_booked or new.booked_by is distinct from old.booked_by then
    delete from public.booking_user_guards
    where booking_id = old.id and user_id = old.booked_by;
  end if;
  return new;
end;
$$;

drop trigger if exists enforce_booking_limits on public.time_slots;
create trigger enforce_booking_limits
before insert or update on public.time_slots
for each row execute function public.enforce_booking_limits();

drop trigger if exists release_booking_guard on public.time_slots;
create trigger release_booking_guard
after delete or update on public.time_slots
for each row execute function public.release_booking_guard();

revoke all on function public.enforce_booking_limits() from public;
revoke all on function public.release_booking_guard() from public;
commit;
