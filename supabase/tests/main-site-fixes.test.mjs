// Replica of the main site's booking tables with their CURRENT policies (from
// the pg_policies export), then supabase/main-site-security-fixes.sql, then
// checks that the holes are closed and the booking flow still works.
// Run with: npm run test:fixes
import { PGlite } from '@electric-sql/pglite';
import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';

const db = new PGlite();
const q = async (sql, p) => (await db.query(sql, p)).rows;
const ok = (m) => console.log('  ok:', m);
async function as(uid, email) {
  await db.exec('reset role');
  await db.query(`select set_config('request.jwt.claim.sub', $1, false)`, [uid ?? '']);
  await db.query(`select set_config('request.jwt.claims', $1, false)`, [JSON.stringify(uid ? { sub: uid, email } : {})]);
  await db.exec(uid ? 'set role authenticated' : 'set role anon');
}
async function refused(label, sql, p, re = /permission denied|row-level security|can only be changed/) {
  try { await db.query(sql, p); } catch (e) { assert.match(e.message, re, label); ok(`${label} (refused: ${e.message.split('\n')[0]})`); return; }
  throw new Error('expected refusal: ' + label);
}

try {
await db.exec(`
  create role anon nologin; create role authenticated nologin;
  create schema auth;
  create table auth.users (id uuid primary key, email text, email_confirmed_at timestamptz, raw_user_meta_data jsonb default '{}');
  create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
  create function auth.jwt() returns jsonb language sql stable as $$ select coalesce(nullif(current_setting('request.jwt.claims', true), ''), '{}')::jsonb $$;
  grant usage on schema auth to anon, authenticated; grant execute on all functions in schema auth to anon, authenticated;
  grant usage on schema public to anon, authenticated;
  alter default privileges in schema public grant all on tables to anon, authenticated;
  alter default privileges in schema public grant execute on functions to anon, authenticated;

  create table public.venues (id uuid primary key default gen_random_uuid(), name text not null, address text not null default '',
    district text not null default '', owner_id uuid, is_active boolean default true, sports text[] not null default '{}',
    subscription_status text, subscription_plan text, current_period_end timestamptz, stripe_customer_id text, stripe_subscription_id text,
    claim_status text, claimed_at timestamptz, booking_enabled boolean, booking_enabled_at timestamptz, rating numeric, review_count int,
    lat numeric, lng numeric, google_maps_url text, google_place_id text, phone text, line_id text, facebook text, photos text[],
    facilities text[], indoor boolean not null default false, total_courts int not null default 1, court_breakdown jsonb not null default '{}',
    court_groups jsonb, open_time text not null default '06:00', close_time text not null default '22:00', price_min int not null default 0,
    price_max int not null default 0, rules text[], rules_images text[], rules_text text, booking_url text, payment_qr_url text,
    promptpay_id text, created_at timestamptz default now(), updated_at timestamptz);
  create table public.bk_courts (id uuid primary key default gen_random_uuid(), venue_id uuid references venues, name text not null,
    sport text not null default 'tennis', status text not null default 'active', type text not null default 'outdoor', court_order int not null default 1, pricing jsonb, created_at bigint);
  create table public.bk_customers (id uuid primary key, name text, phone text, email text);
  create table public.bk_coaches (id uuid primary key default gen_random_uuid(), venue_id uuid not null, auth_user_id uuid, name text not null,
    email text, bio text, photo_url text, hourly_rate int not null, extra_student_price int, max_students int, sports text[] not null default '{tennis}',
    status text not null default 'active', display_order int not null default 0, created_at bigint);
  create table public.bk_coach_availability (id uuid primary key default gen_random_uuid(), coach_id uuid not null references bk_coaches,
    venue_id uuid not null, date date not null, time text not null, created_at bigint);
  create table public.bk_bookings (id uuid primary key default gen_random_uuid(), venue_id uuid references venues, court_id uuid references bk_courts,
    customer_id uuid references bk_customers, coach_id uuid, date text not null, time text not null, name text, phone text, line_id text,
    payment_slip_url text, payment_status text not null, total_amount int, booking_type text, sport text, created_at bigint,
    booking_session_id text, extra_students int, racket_count int, recurring_group_id text);
  create table public.bk_holds (id uuid primary key default gen_random_uuid(), venue_id uuid references venues, court_id uuid references bk_courts,
    coach_id text, date text not null, time text not null, session_id text not null, created_at bigint not null);
  create table public.bk_notifications (id uuid primary key default gen_random_uuid(), venue_id uuid references venues, type text, message text,
    read boolean, time text, created_at bigint);
  create table public.bk_reschedule_requests (id uuid primary key default gen_random_uuid(), venue_id uuid references venues, booking_id uuid,
    name text, phone text, line_id text, new_date text, new_time text, status text, created_at bigint);
  create table public.bk_staff (id uuid primary key default gen_random_uuid(), venue_id uuid not null, email text not null, name text);
  create table public.bookings (id uuid primary key default gen_random_uuid(), venue_id uuid not null references venues, court_number int not null,
    date date not null, hour int not null, status text not null, customer_name text, customer_phone text, booked_by text, note text, sport text,
    created_at timestamptz default now());
  create table public.claims (id uuid primary key default gen_random_uuid(), user_id uuid not null, full_name text not null, phone text not null,
    role text not null default 'owner', status text, venue_id uuid, created_at timestamptz default now());
`);
for (const t of ['venues','bk_courts','bk_customers','bk_coaches','bk_coach_availability','bk_bookings','bk_holds','bk_notifications',
  'bk_reschedule_requests','bk_staff','bookings','claims']) await db.exec(`alter table public.${t} enable row level security`);

// Current policies, as exported.
await db.exec(`
  create policy bk_bookings_coach_read on bk_bookings for select using (coach_id in (select bk_coaches.id from bk_coaches where bk_coaches.auth_user_id = auth.uid()));
  create policy bk_bookings_owner_update on bk_bookings for update using (exists (select 1 from venues where venues.id = bk_bookings.venue_id and venues.owner_id = auth.uid()));
  create policy bk_bookings_public_insert on bk_bookings for insert with check (true);
  create policy bk_bookings_public_read on bk_bookings for select using (true);
  create policy "customers read own bookings" on bk_bookings for select to authenticated using (customer_id = auth.uid());
  create policy bk_avail_read on bk_coach_availability for select using (true);
  create policy bk_avail_write on bk_coach_availability for all to authenticated using (true) with check (true);
  create policy bk_coaches_read on bk_coaches for select using (true);
  create policy bk_coaches_write on bk_coaches for all to authenticated using (true) with check (true);
  create policy bk_courts_public_read on bk_courts for select using (true);
  create policy bk_holds_public_all on bk_holds for all using (true) with check (true);
  create policy bk_notif_owner_read on bk_notifications for select using (exists (select 1 from venues where venues.id = bk_notifications.venue_id and venues.owner_id = auth.uid()));
  create policy bk_notif_public_insert on bk_notifications for insert with check (true);
  create policy bk_resched_public_insert on bk_reschedule_requests for insert with check (true);
  create policy bk_resched_public_read on bk_reschedule_requests for select using (true);
  create policy "owner manages staff" on bk_staff for all using (exists (select 1 from venues v where v.id = bk_staff.venue_id and v.owner_id = auth.uid()));
  create policy "staff reads own row" on bk_staff for select using (email = lower(auth.jwt() ->> 'email'));
  create table public.bk_venue_customers (id uuid primary key default gen_random_uuid(), venue_id uuid not null references venues, name text not null, phone text not null, email text);
  alter table public.bk_venue_customers enable row level security;
  create policy "venue staff manage customers" on bk_venue_customers for all
    using (exists (select 1 from bk_staff s where s.venue_id = bk_venue_customers.venue_id and s.email = lower(auth.jwt() ->> 'email')))
    with check (exists (select 1 from bk_staff s where s.venue_id = bk_venue_customers.venue_id and s.email = lower(auth.jwt() ->> 'email')));
  create policy "Enable read access for all users" on bookings for select using (true);
  create policy bookings_owner_all on bookings for all using (exists (select 1 from venues where venues.id = bookings.venue_id and venues.owner_id = auth.uid()));
  create policy bookings_public_read on bookings for select using (true);
  create policy claims_admin_select on claims for select using ((auth.jwt() ->> 'email') = 'zoloyunho1@gmail.com');
  create policy claims_admin_update on claims for update using ((auth.jwt() ->> 'email') = 'zoloyunho1@gmail.com');
  create policy claims_select on claims for select using (auth.uid() = user_id);
  create policy "Enable read access for all users" on venues for select using (true);
  create policy venues_admin_update on venues for update using ((auth.jwt() ->> 'email') = 'zoloyunho1@gmail.com');
  create policy venues_owner_update on venues for update using (auth.uid() = owner_id);
  create policy venues_public_read on venues for select using (is_active = true);
`);

const OWNER = '00000000-0000-0000-0000-0000000000a1', STRANGER = '00000000-0000-0000-0000-0000000000a2',
      COACHU = '00000000-0000-0000-0000-0000000000a3', ADMIN = '00000000-0000-0000-0000-0000000000a4',
      STAFF = '00000000-0000-0000-0000-0000000000a5', FAKESTAFF = '00000000-0000-0000-0000-0000000000a6';
await q(`insert into auth.users (id, email, email_confirmed_at) values ($1,'owner@x.com',now()),($2,'s@x.com',now()),($3,'coach@x.com',now()),
  ($4,'zoloyunho1@gmail.com',now()),($5,'staff@x.com',now()),($6,'staff2@x.com',null)`, [OWNER, STRANGER, COACHU, ADMIN, STAFF, FAKESTAFF]);
const [V] = await q(`insert into venues (name, owner_id, subscription_status, stripe_customer_id) values ('Club', $1, 'trial', 'cus_123') returning id`, [OWNER]);
const [C] = await q(`insert into bk_courts (venue_id, name) values ($1, 'Court 1') returning id`, [V.id]);
const [CO] = await q(`insert into bk_coaches (venue_id, auth_user_id, name, email, hourly_rate) values ($1, $2, 'Coach Ploy', 'ploy@private.com', 1200) returning id`, [V.id, COACHU]);
await q(`insert into bk_bookings (venue_id, court_id, date, time, name, phone, line_id, payment_status) values ($1,$2,'2026-10-20','18:00','Mint','0899999999','mint_line','pending')`, [V.id, C.id]);
await q(`insert into bookings (venue_id, court_number, date, hour, status, customer_name, customer_phone) values ($1, 1, '2026-10-20', 18, 'booked', 'Ben', '0822222222')`, [V.id]);
await q(`insert into bk_staff (venue_id, email) values ($1, 'staff@x.com'), ($1, 'staff2@x.com')`, [V.id]);
await q(`insert into bk_venue_customers (venue_id, name, phone) values ($1, 'Regular', '0844444444')`, [V.id]);

// Before: confirm the holes exist.
await as(null);
assert.equal((await q(`select phone from bk_bookings`))[0].phone, '0899999999'); ok('BEFORE: anon can read booking phone numbers');
await as(STRANGER, 's@x.com');
assert.equal((await db.query(`update bk_coaches set hourly_rate = 1 where id = $1`, [CO.id])).affectedRows, 1); ok('BEFORE: any signed-in user can change a coach rate');
await db.exec('reset role'); await q(`update bk_coaches set hourly_rate = 1200 where id = $1`, [CO.id]);
await as(OWNER, 'owner@x.com');
assert.equal((await db.query(`update venues set subscription_status = 'active' where id = $1`, [V.id])).affectedRows, 1); ok('BEFORE: owner can activate their own subscription');
await db.exec('reset role'); await q(`update venues set subscription_status = 'trial' where id = $1`, [V.id]);

// Apply the fixes.
await db.exec('reset role');
await db.exec(readFileSync(new URL('../main-site-security-fixes.sql', import.meta.url), 'utf8'));
console.log('fixes applied');

// 1. personal data
await as(null);
assert.equal((await q(`select count(*)::int n from bk_bookings`))[0].n, 0); ok('anon can no longer read bk_bookings');
assert.equal((await q(`select count(*)::int n from bookings`))[0].n, 0); ok('anon can no longer read bookings');
const slots = await q(`select * from bk_taken_slots($1, '2026-10-01', '2026-10-31')`, [V.id]);
assert.equal(slots.length, 1); assert.equal(slots[0].time, '18:00'); assert.ok(!('phone' in slots[0]));
ok('public slot lookup still shows taken times, without personal data');
assert.equal((await q(`select * from taken_hours($1, '2026-10-20')`, [V.id])).length, 1); ok('legacy bookings slot lookup works');
await as(OWNER, 'owner@x.com');
assert.equal((await q(`select phone from bk_bookings`))[0].phone, '0899999999'); ok('owner still reads full bookings');
assert.equal((await q(`select customer_phone from bookings`))[0].customer_phone, '0822222222'); ok('owner still reads legacy bookings');

// 3. guest booking insert
await as(null);
const GUEST_BOOKING = '00000000-0000-0000-0000-0000000000b1';
await q(`insert into bk_bookings (id, venue_id, court_id, date, time, name, phone, payment_status) values ($3, $1,$2,'2026-10-21','19:00','Guest','083-333-3333','pending')`, [V.id, C.id, GUEST_BOOKING]);
ok('guest can still book (unpaid)');
await refused('guest cannot insert a paid booking', `insert into bk_bookings (venue_id, court_id, date, time, payment_status) values ($1,$2,'2026-10-22','19:00','paid')`, [V.id, C.id]);

// 5. notifications by trigger
await as(OWNER, 'owner@x.com');
const notes = await q(`select type, message from bk_notifications`);
assert.ok(notes.some((n) => n.type === 'booking' && n.message.includes('Guest'))); ok('owner notified automatically: ' + notes.at(-1).message);
await as(null);
await refused('anon cannot post notifications', `insert into bk_notifications (venue_id, type, message) values ($1,'spam','spam')`, [V.id]);
await refused('reschedule spam without a real booking refused', `insert into bk_reschedule_requests (venue_id, name, phone, new_date, new_time) values ($1,'Spam','000','2026-10-23','17:00')`, [V.id]);
await refused('reschedule with wrong phone refused', `insert into bk_reschedule_requests (venue_id, booking_id, name, phone, new_date, new_time) values ($1,$2,'X','0899999999','2026-10-23','17:00')`, [V.id, GUEST_BOOKING]);
await q(`insert into bk_reschedule_requests (venue_id, booking_id, name, phone, new_date, new_time) values ($1,$2,'Mint','0833333333','2026-10-23','17:00')`, [V.id, GUEST_BOOKING]);
ok('guest reschedules own booking (booking id + phone)');
await as(OWNER, 'owner@x.com');
assert.ok((await q(`select message from bk_notifications where type='reschedule'`))[0].message.includes('2026-10-23')); ok('reschedule requests notify the owner too');
await as(null);
assert.equal((await q(`select count(*)::int n from bk_reschedule_requests`))[0].n, 0); ok('anon can no longer read reschedule requests');

// 2. coaches
await as(STRANGER, 's@x.com');
assert.equal((await db.query(`update bk_coaches set hourly_rate = 1 where id = $1`, [CO.id])).affectedRows, 0); ok('stranger can no longer change coaches');
await refused('stranger cannot add availability', `insert into bk_coach_availability (coach_id, venue_id, date, time) values ($1,$2,'2026-10-20','10:00')`, [CO.id, V.id]);
await as(COACHU, 'coach@x.com');
await q(`insert into bk_coach_availability (coach_id, venue_id, date, time) values ($1,$2,'2026-10-20','10:00')`, [CO.id, V.id]); ok('coach manages own availability');
await as(null);
assert.equal((await q(`select name from bk_coaches`))[0].name, 'Coach Ploy'); ok('public still sees coach names');
await refused('public cannot read coach emails', `select email from bk_coaches`, []);
await as(OWNER, 'owner@x.com');
assert.equal((await db.query(`update bk_coaches set hourly_rate = 1300 where id = $1`, [CO.id])).affectedRows, 1); ok('owner manages coaches');
assert.equal((await q(`select email from bk_coach_emails($1)`, [V.id]))[0].email, 'ploy@private.com'); ok('owner reads coach emails via function');

// 4. holds
const now = Date.now();
await as(null);
await q(`insert into bk_holds (venue_id, court_id, date, time, session_id, created_at) values ($1,$2,'2026-10-20','20:00','sess-1',$3)`, [V.id, C.id, now]);
ok('guest can still hold a slot');
await refused('hold with a fake timestamp refused', `insert into bk_holds (venue_id, court_id, date, time, session_id, created_at) values ($1,$2,'2026-10-20','21:00','x', 1)`, [V.id, C.id]);
assert.equal((await db.query(`delete from bk_holds`)).affectedRows, 0); ok("anon can no longer delete everyone's holds");
await refused("hold session ids aren't public", `select session_id from bk_holds`, []);
assert.equal((await q(`select count(*)::int n from bk_holds`))[0].n >= 0, true);
assert.equal((await q(`select time from bk_holds`))[0].time, '20:00'); ok('held slots still visible for greying out');
assert.equal((await q(`select * from my_holds('sess-1')`)).length, 1); ok('guest finds own hold via my_holds');
assert.equal((await q(`select release_hold('wrong')`))[0].release_hold, 0);
assert.equal((await q(`select release_hold('sess-1')`))[0].release_hold, 1); ok('guest releases own hold by session id');

// 6. venues
await as(OWNER, 'owner@x.com');
await q(`update venues set name = 'Club Renamed' where id = $1`, [V.id]); ok('owner edits their listing');
await refused('owner cannot activate own subscription', `update venues set subscription_status = 'active' where id = $1`, [V.id]);
await refused('owner cannot hand venue to someone else', `update venues set owner_id = $2 where id = $1`, [V.id, STRANGER]);
await as(null);
await refused('Stripe ids hidden from the public', `select stripe_customer_id from venues`, []);
assert.equal((await q(`select subscription_status from venues`))[0].subscription_status, 'trial'); ok('plan status still readable (no secrets)');
await db.exec('reset role'); await q(`update venues set is_active = false where id = $1`, [V.id]);
await as(null);
assert.equal((await q(`select count(*)::int n from venues`))[0].n, 0); ok('inactive venues hidden from the public');
await as(OWNER, 'owner@x.com');
assert.equal((await q(`select count(*)::int n from venues`))[0].n, 1); ok('owner still sees their inactive venue');

// coach edits own profile, not own rate
await as(COACHU, 'coach@x.com');
assert.equal((await db.query(`update bk_coaches set bio = 'Ex-varsity' where id = $1`, [CO.id])).affectedRows, 1); ok('coach edits own bio');
await refused('coach cannot raise own rate', `update bk_coaches set hourly_rate = 5000 where id = $1`, [CO.id], /Only the venue owner/);

// staff, by confirmed email only
await as(STAFF, 'staff@x.com');
assert.ok((await q(`select count(*)::int n from bk_reschedule_requests`))[0].n >= 1); ok('staff read reschedule requests');
assert.ok((await q(`select count(*)::int n from bookings`))[0].n >= 1); ok('staff read legacy bookings');
assert.equal((await q(`select count(*)::int n from venues`))[0].n, 1); ok('staff see their venue even when inactive');
assert.equal((await q(`select count(*)::int n from bk_venue_customers`))[0].n, 1); ok('staff manage venue customers');
await as(FAKESTAFF, 'staff2@x.com');
assert.equal((await q(`select count(*)::int n from bk_bookings`))[0].n, 0); ok('unconfirmed email listed as staff sees no bookings');
assert.equal((await q(`select count(*)::int n from bk_venue_customers`))[0].n, 0); ok('unconfirmed email sees no venue customers');

// expired holds cleanup
await db.exec('reset role');
await q(`insert into bk_holds (venue_id, court_id, date, time, session_id, created_at) values ($1,$2,'2026-10-20','07:00','old', $3)`, [V.id, C.id, Date.now() - 60 * 60000]);
await as(null);
assert.equal((await q(`select bk_clear_expired_holds() n`))[0].n, 1); ok('expired holds cleared, fresh ones kept');

// 0. admin via app_admins: approves an inactive venue (must actually update the row)
await as(ADMIN, 'zoloyunho1@gmail.com');
assert.equal((await db.query(`update venues set subscription_status = 'active', is_active = true where id = $1`, [V.id])).affectedRows, 1);
ok('admin (from app_admins) approves an inactive venue');

// the file can be run again safely
await db.exec('reset role');
await db.exec(readFileSync(new URL('../main-site-security-fixes.sql', import.meta.url), 'utf8'));
ok('fix file re-runs cleanly');

console.log('\nALL MAIN-SITE FIX TESTS PASSED');
} catch (e) {
  console.error('FAILED:', e.message);
  process.exit(1);
}
