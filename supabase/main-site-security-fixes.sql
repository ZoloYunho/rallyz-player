-- ===========================================================================
-- rallyz.club main site: security fixes for the shared Supabase project
--
-- NOT a Rallyz migration. Review each section, run it on a Supabase branch
-- (or a copy of the project) first, and click through booking, reschedule
-- and the owner dashboard before applying to production.
--
-- Some sections need a small change in the main site's code; those are
-- marked "APP CHANGE".
--
-- Background: the anon key is in every visitor's browser, so a policy
-- "for <cmd> to public using (true)" lets anyone on the internet do <cmd>.
-- ===========================================================================


-- ---------------------------------------------------------------------------
-- 0. One admin list instead of a hard-coded email in policies
--    (Rallyz's migration already creates public.app_admins and seeds it from
--    the current admin email. Run that first, or create the table here.)
-- ---------------------------------------------------------------------------

create table if not exists public.app_admins (
  user_id uuid primary key references auth.users (id) on delete cascade,
  created_at timestamptz not null default now()
);
alter table public.app_admins enable row level security;
revoke all on public.app_admins from anon, authenticated;
insert into public.app_admins (user_id)
select id from auth.users where lower(email) = 'zoloyunho1@gmail.com'
on conflict do nothing;

-- Staff are matched by email. Only count an email the user has confirmed, so
-- nobody can sign up with a staff member's address and inherit their access.
create or replace function public.is_venue_staff(p_venue uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.bk_staff s
    join auth.users u on lower(u.email) = lower(s.email)
    where s.venue_id = p_venue and u.id = auth.uid() and u.email_confirmed_at is not null
  );
$$;
revoke execute on function public.is_venue_staff(uuid) from public;
grant execute on function public.is_venue_staff(uuid) to anon, authenticated;

create or replace function public.is_app_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.app_admins where user_id = auth.uid());
$$;
revoke execute on function public.is_app_admin() from public;
grant execute on function public.is_app_admin() to anon, authenticated;

drop policy if exists claims_admin_select on public.claims;
drop policy if exists claims_admin_update on public.claims;
drop policy if exists claims_admin_select on public.claims;
create policy claims_admin_select on public.claims for select using (public.is_app_admin());
drop policy if exists claims_admin_update on public.claims;
create policy claims_admin_update on public.claims for update using (public.is_app_admin());

drop policy if exists venues_admin_update on public.venues;
create policy venues_admin_update on public.venues for update using (public.is_app_admin());


-- ---------------------------------------------------------------------------
-- 1. Booking personal data was readable by anyone (HIGH)
--    bk_bookings, bookings and bk_reschedule_requests had SELECT using (true),
--    exposing names, phones, LINE IDs and payment slips.
--
--    Public pages only need to know which slots are taken, so they get
--    functions that return slots without personal data. Owners, staff,
--    coaches and customers keep reading full rows through their own policies.
--
--    APP CHANGE: where booking pages read bk_bookings / bookings to grey out
--    taken slots, call the functions below instead:
--      supabase.rpc('bk_taken_slots', { p_venue, p_from, p_to })
--      supabase.rpc('taken_hours', { p_venue, p_date })
--    And after a guest inserts a booking, don't chain .select(): guests can
--    no longer read rows back. Generate the id in the app (crypto.randomUUID())
--    and insert it, or move booking creation into a function.
-- ---------------------------------------------------------------------------

drop policy if exists bk_bookings_public_read on public.bk_bookings;

-- Venue owners and staff read their venue's bookings.
drop policy if exists bk_bookings_owner_read on public.bk_bookings;
create policy bk_bookings_owner_read on public.bk_bookings for select using (
  exists (select 1 from public.venues v where v.id = bk_bookings.venue_id and v.owner_id = auth.uid())
);
drop policy if exists bk_bookings_staff_read on public.bk_bookings;
create policy bk_bookings_staff_read on public.bk_bookings for select using (public.is_venue_staff(venue_id));
drop policy if exists bk_bookings_staff_update on public.bk_bookings;
create policy bk_bookings_staff_update on public.bk_bookings for update using (public.is_venue_staff(venue_id));
-- (bk_bookings_coach_read and "customers read own bookings" stay as they are.)

create or replace function public.bk_taken_slots(p_venue uuid, p_from text, p_to text)
returns table (court_id uuid, coach_id uuid, date text, "time" text, booking_type text)
language sql stable security definer set search_path = public as $$
  select b.court_id, b.coach_id, b.date, b.time, b.booking_type
  from public.bk_bookings b
  where b.venue_id = p_venue and b.date >= p_from and b.date <= p_to;
$$;
revoke execute on function public.bk_taken_slots(uuid, text, text) from public;
grant execute on function public.bk_taken_slots(uuid, text, text) to anon, authenticated;

drop policy if exists "Enable read access for all users" on public.bookings;
drop policy if exists bookings_public_read on public.bookings;
drop policy if exists bookings_staff_read on public.bookings;
create policy bookings_staff_read on public.bookings for select using (public.is_venue_staff(venue_id));
-- (bookings_owner_all stays: owners read and manage their venue's bookings.)

create or replace function public.taken_hours(p_venue uuid, p_date date)
returns table (court_number integer, hour integer, status text)
language sql stable security definer set search_path = public as $$
  select b.court_number, b.hour, b.status
  from public.bookings b
  where b.venue_id = p_venue and b.date = p_date;
$$;
revoke execute on function public.taken_hours(uuid, date) from public;
grant execute on function public.taken_hours(uuid, date) to anon, authenticated;

drop policy if exists bk_resched_public_read on public.bk_reschedule_requests;
drop policy if exists bk_resched_owner_read on public.bk_reschedule_requests;
create policy bk_resched_owner_read on public.bk_reschedule_requests for select using (
  exists (select 1 from public.venues v where v.id = bk_reschedule_requests.venue_id and v.owner_id = auth.uid())
);
drop policy if exists bk_resched_staff_read on public.bk_reschedule_requests;
create policy bk_resched_staff_read on public.bk_reschedule_requests for select using (public.is_venue_staff(venue_id));
drop policy if exists bk_resched_staff_update on public.bk_reschedule_requests;
create policy bk_resched_staff_update on public.bk_reschedule_requests for update using (public.is_venue_staff(venue_id));

-- Reschedule requests must refer to a real booking at that venue, made with
-- the same phone number, so strangers can't flood an owner with requests.
-- (Functions run with owner rights, because guests can no longer read
-- bk_bookings themselves.)
create or replace function public.bk_booking_matches(p_booking uuid, p_venue uuid, p_phone text) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.bk_bookings b
    where b.id = p_booking and b.venue_id = p_venue
      and regexp_replace(coalesce(b.phone, ''), '\D', '', 'g') = regexp_replace(coalesce(p_phone, ''), '\D', '', 'g')
      and coalesce(b.phone, '') <> ''
  );
$$;
revoke execute on function public.bk_booking_matches(uuid, uuid, text) from public;
grant execute on function public.bk_booking_matches(uuid, uuid, text) to anon, authenticated;

drop policy if exists bk_resched_public_insert on public.bk_reschedule_requests;
create policy bk_resched_public_insert on public.bk_reschedule_requests for insert
  with check (public.bk_booking_matches(booking_id, venue_id, phone));

-- APP CHANGE: if customers check their request status on a public page,
-- add a function that looks it up by request id, not a public table read.


drop policy if exists "venue staff manage customers" on public.bk_venue_customers;
create policy "venue staff manage customers" on public.bk_venue_customers for all
  using (public.is_venue_staff(venue_id)) with check (public.is_venue_staff(venue_id));

-- ---------------------------------------------------------------------------
-- 2. Any signed-in user could edit or delete any coach and availability (HIGH)
--    bk_coaches_write and bk_avail_write were ALL using (true) for every
--    authenticated user. Now: venue owners manage their coaches; a coach
--    manages their own availability.
-- ---------------------------------------------------------------------------

drop policy if exists bk_coaches_write on public.bk_coaches;
drop policy if exists bk_coaches_owner_write on public.bk_coaches;
create policy bk_coaches_owner_write on public.bk_coaches for all
  using (exists (select 1 from public.venues v where v.id = bk_coaches.venue_id and v.owner_id = auth.uid()))
  with check (exists (select 1 from public.venues v where v.id = bk_coaches.venue_id and v.owner_id = auth.uid()));

drop policy if exists bk_avail_write on public.bk_coach_availability;
drop policy if exists bk_avail_owner_write on public.bk_coach_availability;
create policy bk_avail_owner_write on public.bk_coach_availability for all
  using (exists (select 1 from public.venues v where v.id = bk_coach_availability.venue_id and v.owner_id = auth.uid()))
  with check (exists (select 1 from public.venues v where v.id = bk_coach_availability.venue_id and v.owner_id = auth.uid()));
drop policy if exists bk_avail_coach_write on public.bk_coach_availability;
create policy bk_avail_coach_write on public.bk_coach_availability for all
  using (exists (select 1 from public.bk_coaches c where c.id = bk_coach_availability.coach_id and c.auth_user_id = auth.uid()))
  with check (exists (select 1 from public.bk_coaches c
                      where c.id = bk_coach_availability.coach_id and c.auth_user_id = auth.uid()
                        and c.venue_id = bk_coach_availability.venue_id));

-- Coaches can edit their own profile (bio, photo, name), but not their rate,
-- venue, status or account link; the owner sets those.
drop policy if exists bk_coaches_self_update on public.bk_coaches;
create policy bk_coaches_self_update on public.bk_coaches for update
  using (auth_user_id = auth.uid()) with check (auth_user_id = auth.uid());

create or replace function public.bk_coaches_guard_self_update() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null or public.is_app_admin()
     or exists (select 1 from public.venues v where v.id = old.venue_id and v.owner_id = auth.uid()) then
    return new;
  end if;
  if new.hourly_rate is distinct from old.hourly_rate
     or new.extra_student_price is distinct from old.extra_student_price
     or new.max_students is distinct from old.max_students
     or new.venue_id is distinct from old.venue_id
     or new.status is distinct from old.status
     or new.auth_user_id is distinct from old.auth_user_id
     or new.display_order is distinct from old.display_order
     or new.email is distinct from old.email then
    raise exception 'Only the venue owner can change these coach fields' using errcode = '42501';
  end if;
  return new;
end;
$$;
drop trigger if exists bk_coaches_guard_self_update on public.bk_coaches;
create trigger bk_coaches_guard_self_update before update on public.bk_coaches
  for each row execute function public.bk_coaches_guard_self_update();

-- Coach emails were public through bk_coaches_read. Hide the column from
-- everyone; owners read it through bk_coach_emails() below. Every other
-- column stays readable, read from the live table so none is missed.
-- APP CHANGE: queries on bk_coaches, including the owner dashboard and
-- .insert().select() / .update().select(), must name their columns instead of
-- select('*'); owners get emails from bk_coach_emails().
do $grant$
declare cols text;
begin
  select string_agg(quote_ident(column_name), ', ' order by ordinal_position) into cols
  from information_schema.columns
  where table_schema = 'public' and table_name = 'bk_coaches' and column_name not in ('email');
  execute 'revoke select on public.bk_coaches from anon, authenticated';
  execute format('grant select (%s) on public.bk_coaches to anon, authenticated', cols);
end;
$grant$;

create or replace function public.bk_coach_emails(p_venue uuid)
returns table (coach_id uuid, email text)
language sql stable security definer set search_path = public as $$
  select c.id, c.email from public.bk_coaches c
  join public.venues v on v.id = c.venue_id
  where c.venue_id = p_venue and (v.owner_id = auth.uid() or public.is_app_admin());
$$;
revoke execute on function public.bk_coach_emails(uuid) from public;
grant execute on function public.bk_coach_emails(uuid) to authenticated;


-- ---------------------------------------------------------------------------
-- 3. Guests could insert bookings already marked paid (HIGH)
--    bk_bookings_public_insert had WITH CHECK (true). Guests may still book,
--    but not as paid and not on behalf of another customer account.
--    Check the exact status values first:
--      select distinct payment_status from public.bk_bookings;
--    and adjust the list below if your "paid" states have other names.
--    Longer term, compute total_amount in a function, not in the browser.
-- ---------------------------------------------------------------------------

drop policy if exists bk_bookings_public_insert on public.bk_bookings;
create policy bk_bookings_public_insert on public.bk_bookings for insert with check (
  payment_status not in ('paid', 'confirmed', 'approved', 'completed')
  and (customer_id is null or customer_id = auth.uid())
);


-- ---------------------------------------------------------------------------
-- 4. Anyone could delete or rewrite every court hold (MEDIUM)
--    bk_holds_public_all was ALL using (true). Guests can still create and
--    see holds (needed to block slots during checkout), but only release
--    their own, by session id, through a function.
--    APP CHANGE: replace delete().eq('session_id', …) with
--      supabase.rpc('release_hold', { p_session: sessionId })
-- ---------------------------------------------------------------------------

drop policy if exists bk_holds_public_all on public.bk_holds;
drop policy if exists bk_holds_public_read on public.bk_holds;
create policy bk_holds_public_read on public.bk_holds for select using (true);
drop policy if exists bk_holds_public_insert on public.bk_holds;
create policy bk_holds_public_insert on public.bk_holds for insert with check (
  -- created_at is epoch milliseconds; a new hold must be "now" (±5 minutes)
  abs(created_at - (extract(epoch from now()) * 1000)::bigint) < 300000
);
drop policy if exists bk_holds_owner_all on public.bk_holds;
create policy bk_holds_owner_all on public.bk_holds for all
  using (exists (select 1 from public.venues v where v.id = bk_holds.venue_id and v.owner_id = auth.uid()))
  with check (exists (select 1 from public.venues v where v.id = bk_holds.venue_id and v.owner_id = auth.uid()));

create or replace function public.release_hold(p_session text) returns integer
language sql security definer set search_path = public as $$
  with gone as (delete from public.bk_holds where session_id = p_session returning 1)
  select count(*)::int from gone;
$$;
revoke execute on function public.release_hold(text) from public;
grant execute on function public.release_hold(text) to anon, authenticated;

-- Expired holds (default: older than 15 minutes). Anyone may call this; it
-- only removes stale holds. APP CHANGE: if the site cleaned up old holds
-- from the browser, call this instead (or schedule it with pg_cron).
create or replace function public.bk_clear_expired_holds(p_max_minutes integer default 15) returns integer
language sql security definer set search_path = public as $$
  with gone as (
    delete from public.bk_holds
    where created_at < (extract(epoch from now()) * 1000)::bigint - greatest(p_max_minutes, 5) * 60000
    returning 1
  )
  select count(*)::int from gone;
$$;
revoke execute on function public.bk_clear_expired_holds(integer) from public;
grant execute on function public.bk_clear_expired_holds(integer) to anon, authenticated;

-- Session ids are what release a hold, so they must not be publicly readable.
-- APP CHANGE: to find "my holds", call my_holds(sessionId) instead of
-- filtering bk_holds by session_id.
do $grant$
declare cols text;
begin
  select string_agg(quote_ident(column_name), ', ' order by ordinal_position) into cols
  from information_schema.columns
  where table_schema = 'public' and table_name = 'bk_holds' and column_name not in ('session_id');
  execute 'revoke select on public.bk_holds from anon, authenticated';
  execute format('grant select (%s) on public.bk_holds to anon, authenticated', cols);
end;
$grant$;

create or replace function public.my_holds(p_session text)
returns setof public.bk_holds
language sql stable security definer set search_path = public as $$
  select * from public.bk_holds where session_id = p_session;
$$;
revoke execute on function public.my_holds(text) from public;
grant execute on function public.my_holds(text) to anon, authenticated;


-- ---------------------------------------------------------------------------
-- 5. Anyone could post notifications to any venue owner (MEDIUM)
--    bk_notif_public_insert had WITH CHECK (true), so anyone could spam an
--    owner's dashboard. Notifications are now written by the database when a
--    booking or reschedule request arrives.
--    APP CHANGE: remove the app's own insert into bk_notifications after a
--    booking/reschedule (the triggers below do it). Messages contain the
--    customer's name as typed, so render them as text, never as HTML.
-- ---------------------------------------------------------------------------

drop policy if exists bk_notif_public_insert on public.bk_notifications;

create or replace function public.bk_notify_owner() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_row jsonb := to_jsonb(new); -- works for both tables without naming their columns
  v_type text;
  v_message text;
begin
  if tg_table_name = 'bk_reschedule_requests' then
    v_type := 'reschedule';
    v_message := coalesce(v_row ->> 'name', 'A customer') || ' asked to move to '
                 || coalesce(v_row ->> 'new_date', '') || ' ' || coalesce(v_row ->> 'new_time', '');
  else
    v_type := 'booking';
    v_message := coalesce(v_row ->> 'name', 'A customer') || ' booked '
                 || coalesce(v_row ->> 'date', '') || ' ' || coalesce(v_row ->> 'time', '');
  end if;
  insert into public.bk_notifications (venue_id, type, message, read, created_at)
  values ((v_row ->> 'venue_id')::uuid, v_type, v_message, false, (extract(epoch from now()) * 1000)::bigint);
  return new;
exception when others then
  return new; -- a notification problem must never block a booking
end;
$$;

drop trigger if exists bk_bookings_notify_owner on public.bk_bookings;
create trigger bk_bookings_notify_owner after insert on public.bk_bookings
  for each row execute function public.bk_notify_owner();
drop trigger if exists bk_resched_notify_owner on public.bk_reschedule_requests;
create trigger bk_resched_notify_owner after insert on public.bk_reschedule_requests
  for each row execute function public.bk_notify_owner();


-- ---------------------------------------------------------------------------
-- 6. Venue owners could change their own plan, owner and approval (HIGH)
--    venues_owner_update allowed every column, including subscription_status,
--    current_period_end, stripe ids, owner_id, claim_status and is_active.
--    The trigger lets owners edit their listing but not those fields.
--    Stripe webhooks use the service role, which bypasses this check.
-- ---------------------------------------------------------------------------

create or replace function public.venues_guard_owner_update() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null or public.is_app_admin() then
    return new; -- service role (webhooks, cron) and admins
  end if;
  if new.owner_id is distinct from old.owner_id
     or new.subscription_status is distinct from old.subscription_status
     or new.subscription_plan is distinct from old.subscription_plan
     or new.current_period_end is distinct from old.current_period_end
     or new.stripe_customer_id is distinct from old.stripe_customer_id
     or new.stripe_subscription_id is distinct from old.stripe_subscription_id
     or new.claim_status is distinct from old.claim_status
     or new.claimed_at is distinct from old.claimed_at
     or new.is_active is distinct from old.is_active
     or new.booking_enabled_at is distinct from old.booking_enabled_at
     or new.rating is distinct from old.rating
     or new.review_count is distinct from old.review_count then
    raise exception 'These venue fields can only be changed by Rallyz' using errcode = '42501';
  end if;
  return new;
end;
$$;

drop trigger if exists venues_guard_owner_update on public.venues;
create trigger venues_guard_owner_update before update on public.venues
  for each row execute function public.venues_guard_owner_update();

drop policy if exists venues_owner_update on public.venues;
create policy venues_owner_update on public.venues for update
  using (auth.uid() = owner_id) with check (auth.uid() = owner_id);

-- Only active venues are public. The duplicate "Enable read access for all
-- users" policy showed inactive venues too; owners still see their own.
drop policy if exists "Enable read access for all users" on public.venues;
drop policy if exists venues_owner_read on public.venues;
create policy venues_owner_read on public.venues for select using (auth.uid() = owner_id);
drop policy if exists venues_admin_read on public.venues;
create policy venues_admin_read on public.venues for select using (public.is_app_admin());
drop policy if exists venues_staff_read on public.venues;
create policy venues_staff_read on public.venues for select using (public.is_venue_staff(id));

-- Hide the two Stripe ids from everyone using the anon key. APP CHANGE:
-- queries must select named columns, not select('*'); only server code with
-- the service role (Stripe webhooks, billing portal) reads the Stripe ids.
do $grant$
declare cols text;
begin
  select string_agg(quote_ident(column_name), ', ' order by ordinal_position) into cols
  from information_schema.columns
  where table_schema = 'public' and table_name = 'venues' and column_name not in ('stripe_customer_id', 'stripe_subscription_id');
  execute 'revoke select on public.venues from anon, authenticated';
  execute format('grant select (%s) on public.venues to anon, authenticated', cols);
end;
$grant$;
