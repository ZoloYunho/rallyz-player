// Runs the migrations in an embedded Postgres (PGlite) with stand-ins for
// Supabase's auth schema and roles, then walks through the main flows as
// different users. Run with: npm run test:db
import { PGlite } from '@electric-sql/pglite';
import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';

const MIG = new URL('../migrations/', import.meta.url).pathname;
try {
const db = new PGlite();

// Minimal Supabase environment: roles, auth schema, auth.uid(), realtime publication.
await db.exec(`
  create role anon nologin; create role authenticated nologin;
  create schema auth;
  create table auth.users (id uuid primary key, email text, raw_user_meta_data jsonb default '{}'::jsonb);
  create function auth.uid() returns uuid language sql stable as
    $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
  grant usage on schema auth to anon, authenticated;
  grant execute on function auth.uid() to anon, authenticated;
  grant usage on schema public to anon, authenticated;
  alter default privileges in schema public grant all on tables to anon, authenticated;
  alter default privileges in schema public grant all on sequences to anon, authenticated;
  alter default privileges in schema public grant execute on functions to anon, authenticated;
  create publication supabase_realtime;
`);

// The main site's existing objects: a user who signed up before Rallyz, and
// one of the main site's own functions that must keep working.
const EXISTING = '00000000-0000-0000-0000-0000000000ee';
await db.query(`insert into auth.users (id, email, raw_user_meta_data) values ($1, 'old@x.com', '{"name":"Old Member","avatar_url":"http://insecure/a.png"}')`, [EXISTING]);
const OLD_ADMIN = '00000000-0000-0000-0000-0000000000ad';
await db.query(`insert into auth.users (id, email) values ($1, 'ZoloYunho1@gmail.com')`, [OLD_ADMIN]);
await db.exec(`create function public.main_site_search_courts() returns int language sql as $$ select 42 $$;
  grant execute on function public.main_site_search_courts() to authenticated;`);
// Replica of the main site's private profiles table (phone must never leak)
// and its public venues table.
await db.exec(`
  create table public.profiles (id uuid primary key, full_name text, phone text, created_at timestamptz default now());
  alter table public.profiles enable row level security;
  create policy profiles_select on public.profiles for select using (auth.uid() = id);
  create policy profiles_update on public.profiles for update using (auth.uid() = id);
  create table public.venues (id uuid primary key default gen_random_uuid(), name text not null, district text not null,
    address text not null default '', google_maps_url text, photos text[], is_active boolean default true, sports text[] not null default '{}');
  alter table public.venues enable row level security;
  create policy venues_public_read on public.venues for select using (true);
`);
await db.query(`insert into public.profiles (id, full_name, phone) values ($1, 'Somchai Old-Member', '0811111111')`, [EXISTING]);
const VENUE = (await db.query(`insert into public.venues (name, district, address, sports) values ('Lumphini Park Tennis', 'Pathum Wan', 'Rama IV Rd', '{tennis}') returning id`)).rows[0].id;

await db.exec(readFileSync(MIG + '20261014000100_core.sql', 'utf8'));
await db.exec(readFileSync(MIG + '20261014000200_functions.sql', 'utf8'));
console.log('migrations applied');

// --- shared-project safety
{
  const [p] = (await db.query(`select display_name, avatar_url from public.player_profiles where id = $1`, [EXISTING])).rows;
  assert.equal(p.display_name, 'Somchai Old-Member'); assert.equal(p.avatar_url, null);
  console.log("  ok: existing user got a player profile named from the main site's full_name (unsafe avatar dropped)");
  assert.equal((await db.query(`select count(*)::int n from public.app_admins where user_id = $1`, [OLD_ADMIN])).rows[0].n, 1);
  console.log("  ok: main site's admin email seeded into app_admins");
  await db.exec(`reset role`);
  await db.query(`select set_config('request.jwt.claim.sub', $1, false)`, [EXISTING]);
  await db.exec(`set role authenticated`);
  assert.equal((await db.query(`select public.main_site_search_courts() n`)).rows[0].n, 42);
  console.log("  ok: main site's own functions still callable");
  await db.query(`select public.rallyz_ensure_profile()`);
  console.log('  ok: ensure_profile is a no-op when the profile exists');
  await db.exec(`reset role`);
  // Sign-up must never fail because of Rallyz, even with an oversized name.
  await db.query(`insert into auth.users (id, email, raw_user_meta_data) values ('00000000-0000-0000-0000-0000000000e1', 'x@x.com', $1)`,
    [JSON.stringify({ full_name: 'x'.repeat(500) })]);
  console.log('  ok: sign-up succeeds and profile name is trimmed');
  // A missing profile is recreated on demand.
  await db.query(`delete from public.player_profiles where id = '00000000-0000-0000-0000-0000000000e1'`);
  await db.query(`select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000e1', false)`);
  await db.exec(`set role authenticated`);
  await db.query(`select public.rallyz_ensure_profile()`);
  assert.equal((await db.query(`select count(*)::int n from public.player_profiles where id = '00000000-0000-0000-0000-0000000000e1'`)).rows[0].n, 1);
  await db.exec(`reset role`);
  console.log('  ok: missing profile recreated by ensure_profile');
}

const U = {
  A: '00000000-0000-0000-0000-00000000000a',
  B: '00000000-0000-0000-0000-00000000000b',
  C: '00000000-0000-0000-0000-00000000000c',
  D: '00000000-0000-0000-0000-00000000000d',
  M: '00000000-0000-0000-0000-0000000000ff',
};
for (const [k, id] of Object.entries(U)) {
  await db.query(`insert into auth.users (id, email, raw_user_meta_data) values ($1, $2, $3)`,
    [id, `${k.toLowerCase()}@x.com`, JSON.stringify({ full_name: 'User ' + k })]);
}
await db.query(`insert into public.app_admins (user_id) values ($1)`, [U.M]);

async function as(uid) {
  await db.exec(`reset role`);
  await db.query(`select set_config('request.jwt.claim.sub', $1, false)`, [uid ?? '']);
  await db.exec(uid ? `set role authenticated` : `set role anon`);
}
async function q(sql, params) { return (await db.query(sql, params)).rows; }
async function fails(label, sql, params, re) {
  try { await db.query(sql, params); } catch (e) {
    if (re) assert.match(e.message, re, label);
    console.log('  ok (refused):', label, '-', e.message.split('\n')[0]);
    return;
  }
  throw new Error('expected failure: ' + label);
}
const ok = (label) => console.log('  ok:', label);

// --- profiles
await as(U.B);
assert.equal((await q(`select display_name from player_profiles where id=$1`, [U.B]))[0].display_name, 'User B'); ok('profile created from auth user');
await q(`update player_profiles set level=4, areas='{Ari}', onboarded=true where id=$1`, [U.B]); ok('user edits own profile');
await fails('user cannot make self admin', `update player_profiles set is_founding_organizer=true where id=$1`, [U.B], /permission denied/);
const r0 = await db.query(`update player_profiles set level=9 where id=$1`, [U.A]);
assert.equal(r0.affectedRows ?? 0, 0); ok('user cannot edit others');

// --- events
const in3d = new Date(Date.now() + 3 * 86400e3).toISOString();
const in3dEnd = new Date(Date.now() + 3 * 86400e3 + 2 * 3600e3).toISOString();
await as(U.A);
const [ev] = await q(`insert into events (organizer_id,title,starts_at,ends_at,venue_name,area,level_min,level_max,fee_thb,capacity)
  values ($1,'Tuesday doubles',$2,$3,'Lumphini courts','Lumphini',3,6,300,2) returning id`, [U.A, in3d, in3dEnd]);
const E1 = ev.id; ok('organizer creates event');
await fails('cannot set counters on insert', `insert into events (organizer_id,title,starts_at,ends_at,venue_name,area,level_min,level_max,capacity,confirmed_count)
  values ($1,'x x x',$2,$3,'v v','Ari',1,2,2,99)`, [U.A, in3d, in3dEnd], /permission denied/);
await as(U.B);
await fails('cannot create event for someone else', `insert into events (organizer_id,title,starts_at,ends_at,venue_name,area,level_min,level_max,capacity)
  values ($1,'x x x',$2,$3,'v v','Ari',1,2,2)`, [U.A, in3d, in3dEnd], /row-level security/);
const upd = await db.query(`update events set title='hacked' where id=$1`, [E1]);
assert.equal(upd.affectedRows ?? 0, 0); ok('cannot edit someone else\'s event');
await fails('cannot write participants directly', `insert into event_participants (event_id,user_id,status) values ($1,$2,'confirmed')`, [E1, U.B], /permission denied/);

await as(U.A);
assert.equal((await q(`select count(*)::int n from conversation_members cm join conversations c on c.id=cm.conversation_id where c.event_id=$1`, [E1]))[0].n, 1);
ok('event chat created with organizer');
await fails('organizer cannot join own event', `select join_event($1)`, [E1], /organizing/);

await as(U.B); assert.equal((await q(`select join_event($1) s`, [E1]))[0].s, 'confirmed');
await as(U.C); assert.equal((await q(`select join_event($1) s`, [E1]))[0].s, 'confirmed');
await as(U.D); assert.equal((await q(`select join_event($1) s`, [E1]))[0].s, 'waitlisted');
await as(U.D); assert.equal((await q(`select join_event($1) s`, [E1]))[0].s, 'waitlisted'); ok('instant join fills then waitlists; rejoin is idempotent');
let e = (await q(`select confirmed_count, waitlist_count from events where id=$1`, [E1]))[0];
assert.deepEqual([e.confirmed_count, e.waitlist_count], [2, 1]); ok('counters 2 confirmed / 1 waitlisted');

await as(U.C);
assert.equal((await q(`select count(*)::int n from event_participants where event_id=$1`, [E1]))[0].n, 1); ok('player sees only own entry');
await as(U.A);
assert.equal((await q(`select count(*)::int n from event_participants where event_id=$1`, [E1]))[0].n, 3); ok('organizer sees all entries');

await as(U.B);
assert.equal((await q(`select leave_event($1) late`, [E1]))[0].late, false);
e = (await q(`select confirmed_count, waitlist_count from events where id=$1`, [E1]))[0];
assert.deepEqual([e.confirmed_count, e.waitlist_count], [2, 0]);
await as(U.D);
assert.equal((await q(`select status from event_participants where event_id=$1 and user_id=$2`, [E1, U.D]))[0].status, 'confirmed');
ok('leaving promotes the waitlist');

await as(null);
const roster = await q(`select display_name, status from get_roster($1)`, [E1]);
assert.deepEqual(roster.map(r => r.display_name).sort(), ['User C', 'User D']); ok('public roster for anon');
assert.equal((await q(`select count(*)::int n from event_participants`))[0].n, 0); ok('anon sees no entries');

// --- chat membership follows status
await as(U.C);
const [conv] = await q(`select id from conversations where event_id=$1`, [E1]);
assert.ok(conv, 'confirmed player sees event chat');
await q(`insert into messages (conversation_id, body) values ($1, 'See you there')`, [conv.id]); ok('confirmed player posts in event chat');
await as(U.B);
assert.equal((await q(`select count(*)::int n from messages`)).at(0).n, 0); ok('player who left cannot read event chat');
await fails('non-member cannot post', `insert into messages (conversation_id, body) values ($1, 'hi')`, [conv.id], /row-level/);
await as(U.D);
const inbox = await q(`select title, unread from my_conversations()`);
assert.equal(inbox[0].unread, 1); ok('inbox shows unread count');

// --- payments
await as(U.C);
assert.equal((await q(`select promptpay_id from get_payment_info($1)`, [E1]))[0].promptpay_id, null); ok('no PromptPay set yet');
await as(U.A);
await q(`insert into organizer_settings (user_id, promptpay_id) values ($1, '0812345678')`, [U.A]);
await as(U.C);
assert.equal((await q(`select promptpay_id from get_payment_info($1)`, [E1]))[0].promptpay_id, '0812345678'); ok('confirmed player gets PromptPay id');
await as(U.B);
assert.equal((await q(`select * from get_payment_info($1)`, [E1])).length, 0); ok('non-participant gets nothing');
assert.equal((await q(`select * from organizer_settings`)).length, 0); ok('settings private');
await as(U.C);
await q(`select set_payment_status($1,$2,'claimed')`, [E1, U.C]); ok('player marks paid (claimed)');
await fails('player cannot confirm own payment', `select set_payment_status($1,$2,'paid')`, [E1, U.C], /cannot change/);
await fails('player cannot touch others', `select set_payment_status($1,$2,'claimed')`, [E1, U.D], /cannot change/);
await as(U.A);
await q(`select set_payment_status($1,$2,'paid')`, [E1, U.C]); ok('organizer confirms payment');

// --- private notes
await as(U.A);
await q(`update event_private_notes set note='Meet at court 3' where event_id=$1`, [E1]);
await as(U.C);
assert.equal((await q(`select note from event_private_notes where event_id=$1`, [E1]))[0].note, 'Meet at court 3'); ok('confirmed player reads meeting note');
await as(U.B);
assert.equal((await q(`select note from event_private_notes where event_id=$1`, [E1])).length, 0); ok('others cannot');

// --- approval flow + capacity increase
await as(U.A);
const [ev2] = await q(`insert into events (organizer_id,title,starts_at,ends_at,venue_name,area,level_min,level_max,capacity,entry_mode)
  values ($1,'Approval match',$2,$3,'Ari courts','Ari',4,7,1,'approval') returning id`, [U.A, in3d, in3dEnd]);
const E2 = ev2.id;
await as(U.B); assert.equal((await q(`select join_event($1) s`, [E2]))[0].s, 'pending');
await as(U.C); assert.equal((await q(`select join_event($1) s`, [E2]))[0].s, 'pending'); ok('approval mode -> pending');
await as(U.B); await fails('player cannot approve', `select decide_participant($1,$2,true)`, [E2, U.C], /organizer/);
await as(U.A);
assert.equal((await q(`select decide_participant($1,$2,true) s`, [E2, U.B]))[0].s, 'confirmed');
assert.equal((await q(`select decide_participant($1,$2,true) s`, [E2, U.C]))[0].s, 'waitlisted'); ok('approve fills, then waitlists');
await q(`update events set capacity=2 where id=$1`, [E2]);
assert.equal((await q(`select status from event_participants where event_id=$1 and user_id=$2`, [E2, U.C]))[0].status, 'confirmed'); ok('raising capacity promotes waitlist');
assert.equal((await q(`select decide_participant($1,$2,false) s`, [E2, U.B]))[0].s, 'declined');
await as(U.B); await fails('declined player cannot rejoin', `select join_event($1)`, [E2], /declined/);

// --- late cancellation
await as(U.A);
const soon = new Date(Date.now() + 5 * 3600e3).toISOString(), soonEnd = new Date(Date.now() + 7 * 3600e3).toISOString();
const [ev3] = await q(`insert into events (organizer_id,title,starts_at,ends_at,venue_name,area,level_min,level_max,capacity)
  values ($1,'Tonight',$2,$3,'Sathorn club','Sathorn',1,9,4) returning id`, [U.A, soon, soonEnd]);
await as(U.D); await q(`select join_event($1)`, [ev3.id]);
assert.equal((await q(`select leave_event($1) late`, [ev3.id]))[0].late, true); ok('leaving inside the deadline is flagged late');
await as(U.C); await q(`select join_event($1)`, [ev3.id]);

// --- reminders
await as(null); await db.exec('reset role');
const n = (await q(`select send_event_reminders() n`))[0].n;
assert.equal(n, 2); ok('reminders sent to confirmed player + organizer');
assert.equal((await q(`select send_event_reminders() n`))[0].n, 0); ok('reminders sent once');

// --- cancel
await as(U.C); await fails('only organizer cancels', `select cancel_event($1,'x')`, [E1], /organizer/);
await as(U.A); await q(`select cancel_event($1,'Rain')`, [E1]);
await as(U.D); await fails('cannot join cancelled', `select join_event($1)`, [E1], /cancelled/);
assert.ok((await q(`select body from notifications where kind='event_cancelled'`))[0].body.includes('Rain')); ok('cancellation notifies players');
await as(U.A); await fails('cannot edit cancelled event', `update events set title='zzz' where id=$1 returning id`, [E1]).catch(async () => {
  const r = await db.query(`update events set title='zzz' where id=$1`, [E1]); assert.equal(r.affectedRows ?? 0, 0); ok('cancelled event is locked');
});

// --- direct chat
await as(U.B);
const d1 = (await q(`select get_or_create_direct($1) id`, [U.C]))[0].id;
await as(U.C);
const d2 = (await q(`select get_or_create_direct($1) id`, [U.B]))[0].id;
assert.equal(d1, d2); ok('direct chat is reused');
await as(U.D);
assert.equal((await q(`select count(*)::int n from conversations where id=$1`, [d1]))[0].n, 0); ok('outsiders cannot see direct chat');

// --- instructors
await as(U.B);
await q(`insert into coach_profiles (user_id, headline, rate_private_thb, areas, languages) values ($1,'Patient coach for beginners',1200,'{Ari}','{English,Thai}')`, [U.B]);
await fails('coach cannot self-approve', `update coach_profiles set status='approved' where user_id=$1`, [U.B], /permission denied/);
await as(null);
assert.equal((await q(`select count(*)::int n from coach_profiles`))[0].n, 0); ok('pending instructor hidden from public');
await as(U.C);
await fails('cannot request unapproved instructor', `select request_lesson($1,'private',1::smallint,$2,'hi')`, [U.B, in3d], /not available/);
await fails('non-admin cannot review', `select review_coach($1,true)`, [U.B], /Admins/);
await as(U.M);
assert.equal((await q(`select count(*)::int n from coach_profiles`))[0].n, 1); ok('admin sees pending');
await q(`select review_coach($1,false,'Add your certifications')`, [U.B]);
await as(U.B);
await q(`update coach_profiles set certifications='ITF Level 1' where user_id=$1`, [U.B]);
assert.equal((await q(`select status from coach_profiles where user_id=$1`, [U.B]))[0].status, 'pending'); ok('edited rejected profile returns to review');
await as(U.M); await q(`select review_coach($1,true)`, [U.B]);
await as(null);
assert.equal((await q(`select count(*)::int n from coach_profiles`))[0].n, 1); ok('approved instructor public');
await as(U.C);
const lc = (await q(`select request_lesson($1,'private',1::smallint,$2,'Backhand help') id`, [U.B, in3d]))[0].id;
assert.equal(lc, d1); ok('lesson request reuses the direct chat');
const [lr] = await q(`select id, status from lesson_requests`);
assert.equal(lr.status, 'pending');
await fails('player cannot accept own request', `select respond_lesson_request($1,true)`, [lr.id], /instructor/);
await as(U.B); await q(`select respond_lesson_request($1,true)`, [lr.id]);
assert.equal((await q(`select count(*)::int n from messages where conversation_id=$1`, [lc]))[0].n, 2); ok('request + acceptance posted in chat');
await as(U.D);
assert.equal((await q(`select count(*)::int n from lesson_requests`))[0].n, 0); ok('others cannot see lesson requests');

// --- notifications & metrics
await as(U.A);
const kinds = (await q(`select kind from notifications order by id`)).map(r => r.kind);
assert.ok(kinds.includes('joined') && kinds.includes('waitlisted_join') && kinds.includes('payment_claimed') && kinds.includes('join_request'));
ok('organizer notifications: ' + [...new Set(kinds)].join(', '));
await fails('cannot insert notifications', `insert into notifications (user_id, kind, body) values ($1,'x','y')`, [U.B], /permission denied/);
await fails('non-admin metrics', `select * from admin_weekly_metrics(4)`, [], /Admins/);
await as(U.M);
const m = await q(`select * from admin_weekly_metrics(4)`);
assert.equal(m.length, 4); assert.ok(Number(m[0].events_posted) >= 3); ok('admin metrics: ' + JSON.stringify(m[0], (k, v) => typeof v === 'bigint' ? Number(v) : v));

await as(U.B);
await fails('non-admin cannot grant badge', `select admin_set_founding_organizer($1,true)`, [U.B], /Admins/);
await as(U.M);
await q(`select admin_set_founding_organizer($1,true)`, [U.A]);
assert.equal((await q(`select is_founding_organizer f from player_profiles where id=$1`, [U.A]))[0].f, true); ok('admin grants Founding Organizer');
await as(null);
const open = await q(`select title, spots_left from events where cancelled_at is null and spots_left > 0 order by title`);
ok('spots_left filter: ' + JSON.stringify(open));
// --- main-site privacy and venue link
await as(U.B);
assert.equal((await q(`select count(*)::int n from public.profiles`))[0].n, 0); ok("players can't read the main site's profiles (phones stay private)");
await fails('player_profiles has no phone column', `select phone from public.player_profiles`, [], /phone/);
await as(U.A);
const [ve] = await q(`insert into events (organizer_id,title,starts_at,ends_at,venue_id,venue_name,area,level_min,level_max,capacity)
  values ($1,'At a listed venue',$2,$3,$4,'Lumphini Park Tennis','Lumphini',2,5,4) returning id, venue_id`, [U.A, in3d, in3dEnd, VENUE]);
assert.equal(ve.venue_id, VENUE); ok('event linked to a main-site venue');
await db.exec('reset role');
await q(`delete from public.venues where id=$1`, [VENUE]);
assert.equal((await q(`select venue_id from events where id=$1`, [ve.id]))[0].venue_id, null); ok('deleting a venue keeps the event (link cleared)');
console.log('\nALL DATABASE TESTS PASSED');
} catch (e) {
  console.error('FAILED:', e.message);
  process.exit(1);
}
