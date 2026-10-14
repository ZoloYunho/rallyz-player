// Profile privacy (migration 0600): only people who take part in Rallyz are visible.
// Run with: npm run test:privacy
import { PGlite } from '@electric-sql/pglite';
import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';

const MIG = new URL('../migrations/', import.meta.url).pathname;
const db = new PGlite();
const q = async (sql, p) => (await db.query(sql, p)).rows;
const ok = (m) => console.log('  ok:', m);
async function as(uid) {
  await db.exec('reset role');
  await db.query(`select set_config('request.jwt.claim.sub', $1, false)`, [uid ?? '']);
  await db.exec(uid ? 'set role authenticated' : 'set role anon');
}
const sees = async (viewer, target) => {
  await as(viewer);
  const r = await q(`select id from player_profiles where id = $1`, [target]);
  await db.exec('reset role');
  return r.length === 1;
};

try {
await db.exec(`
  create role anon nologin; create role authenticated nologin;
  create schema auth;
  create table auth.users (id uuid primary key, email text, raw_user_meta_data jsonb default '{}'::jsonb);
  create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
  grant usage on schema auth to anon, authenticated; grant execute on function auth.uid() to anon, authenticated;
  grant usage on schema public to anon, authenticated;
  alter default privileges in schema public grant all on tables to anon, authenticated;
  alter default privileges in schema public grant all on sequences to anon, authenticated;
  alter default privileges in schema public grant execute on functions to anon, authenticated;
  create publication supabase_realtime;
  create table public.profiles (id uuid primary key, full_name text, phone text);
  alter table public.profiles enable row level security;
  create table public.venues (id uuid primary key default gen_random_uuid(), name text not null, district text not null,
    address text not null default '', google_maps_url text, photos text[], is_active boolean default true, sports text[] not null default '{}');
  alter table public.venues enable row level security;
`);
for (const f of ['20261014000100_core.sql', '20261014000200_functions.sql', '20261014000400_partner_enum.sql',
                 '20261014000500_partner.sql', '20261014000600_profile_privacy.sql']) {
  await db.exec(readFileSync(MIG + f, 'utf8'));
}
// Running it twice must be safe.
await db.exec(readFileSync(MIG + '20261014000600_profile_privacy.sql', 'utf8'));
ok('privacy migration applies and re-runs');

const id = (n) => `00000000-0000-0000-0000-0000000000${String(n).padStart(2, '0')}`;
const U = { owner: id(1), viewer: id(2), coach: id(3), org: id(4), joiner: id(5), poster: id(6), admin: id(7), chatty: id(8) };
for (const [k, v] of Object.entries(U)) {
  await q(`insert into auth.users (id, email, raw_user_meta_data) values ($1, $2, $3)`, [v, `${k}@x.com`, JSON.stringify({ full_name: k })]);
}
await q(`insert into app_admins (user_id) values ($1)`, [U.admin]);

// A venue owner who never used Rallyz: hidden from players and anon, visible to self and admins.
assert.equal(await sees(U.viewer, U.owner), false); ok('signed-in player cannot see a non-player (venue owner)');
assert.equal(await sees(null, U.owner), false); ok('anon cannot see a non-player');
assert.equal(await sees(U.owner, U.owner), true); ok('everyone sees their own profile');
assert.equal(await sees(U.admin, U.owner), true); ok('admins see everyone');

// Onboarded -> visible.
await q(`update player_profiles set onboarded = true where id = $1`, [U.viewer]);
assert.equal(await sees(U.owner, U.viewer), true); ok('onboarded player is visible');
assert.equal(await sees(null, U.viewer), true); ok('onboarded player visible to anon (names on rosters)');

// Approved instructor -> visible; pending is not.
await q(`insert into coach_profiles (user_id, headline, rate_private_thb) values ($1, 'Coach for all', 1000)`, [U.coach]);
assert.equal(await sees(U.viewer, U.coach), false); ok('pending instructor not visible');
await q(`update coach_profiles set status = 'approved' where user_id = $1`, [U.coach]);
assert.equal(await sees(U.viewer, U.coach), true); ok('approved instructor visible');

// Organizer -> visible; joiner (pending/confirmed) -> visible.
const [ev] = await q(`insert into events (organizer_id, title, starts_at, ends_at, venue_name, area, level_min, level_max, capacity)
  values ($1, 'Test event', now() + interval '2 days', now() + interval '2 days 2 hours', 'Court', 'Ari', 1, 9, 4) returning id`, [U.org]);
assert.equal(await sees(null, U.org), true); ok('event organizer visible');
assert.equal(await sees(U.viewer, U.joiner), false);
await as(U.joiner); await q(`select join_event($1)`, [ev.id]); await db.exec('reset role');
assert.equal(await sees(U.viewer, U.joiner), true); ok('player who joined an event becomes visible');

// Partner post author -> visible.
await q(`update player_profiles set safety_ack_at = now() where id = $1`, [U.poster]);
await q(`insert into play_requests (author_id, starts_at, ends_at, area, level_min, level_max)
  values ($1, now() + interval '1 day', now() + interval '1 day 2 hours', 'Ari', 1, 9)`, [U.poster]);
assert.equal(await sees(U.viewer, U.poster), true); ok('partner post author visible');

// Shared chat -> visible to the other person only.
assert.equal(await sees(U.viewer, U.chatty), false);
await as(U.chatty); await q(`select get_or_create_direct($1)`, [U.viewer]); await db.exec('reset role');
// viewer is onboarded; chatty is not, but now shares a chat with viewer.
assert.equal(await sees(U.viewer, U.chatty), true); ok('chat partner visible to the person they chat with');
assert.equal(await sees(U.joiner, U.chatty), false); ok('but still hidden from everyone else');

// Rosters and inbox still work (security definer functions).
await as(null);
const roster = await q(`select display_name from get_roster($1)`, [ev.id]);
assert.equal(roster.length, 1); ok('public roster still shows names');
await as(U.viewer);
const inbox = await q(`select title from my_conversations()`);
assert.equal(inbox[0].title, 'chatty'); ok('inbox still shows the other person\'s name');
await db.exec('reset role');

// The helper is not callable through the API schema.
await as(U.viewer);
const r = await q(`select count(*)::int n from information_schema.routines where routine_schema = 'public' and routine_name = 'profile_visible'`);
assert.equal(r[0].n, 0); ok('profile_visible is not in the public (API) schema');
await db.exec('reset role');

console.log('\nALL PRIVACY TESTS PASSED');
} catch (e) {
  console.error('FAILED:', e);
  process.exit(1);
}
