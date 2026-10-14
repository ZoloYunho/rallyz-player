// P2 (find a partner) flows on an embedded Postgres with Supabase stand-ins.
// Run with: npm run test:partner
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
async function refused(label, sql, p, re) {
  try { await db.query(sql, p); } catch (e) {
    if (re) assert.match(e.message, re, label);
    ok(`${label} (refused: ${e.message.split('\n')[0]})`);
    return;
  }
  throw new Error('expected refusal: ' + label);
}

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
  create policy venues_public_read on public.venues for select using (true);
`);
for (const f of ['20261014000100_core.sql', '20261014000200_functions.sql', '20261014000400_partner_enum.sql', '20261014000500_partner.sql']) {
  await db.exec(readFileSync(MIG + f, 'utf8'));
}
console.log('migrations applied');

const U = { A: 'a', B: 'b', C: 'c', D: 'd', M: 'e' };
for (const k of Object.keys(U)) U[k] = `00000000-0000-0000-0000-00000000000${U[k]}`;
for (const [k, id] of Object.entries(U)) {
  await q(`insert into auth.users (id, email, raw_user_meta_data) values ($1, $2, $3)`, [id, `${k}@x.com`, JSON.stringify({ full_name: 'Player ' + k })]);
}
await q(`update player_profiles set level = 5, onboarded = true`);
await q(`insert into app_admins (user_id) values ($1)`, [U.M]);

const at = (h) => new Date(Date.now() + h * 3600e3).toISOString();

// --- profile fields
await as(U.A);
await q(`update player_profiles set play_times = '{weekday_evening,weekend_morning}', formats = '{singles}' where id = $1`, [U.A]);
ok('player sets usual play times and formats');
await refused('unknown play time rejected', `update player_profiles set play_times = '{midnight}' where id = $1`, [U.A], /check/);

// --- posting needs the safety tips
await refused('post before safety tips refused', `insert into play_requests (author_id, starts_at, ends_at, area, level_min, level_max) values ($1,$2,$3,'Ari',4,6)`,
  [U.A, at(48), at(50)], /safety/);
await q(`update player_profiles set safety_ack_at = now() where id = $1`, [U.A]);
const [P1] = await q(`insert into play_requests (author_id, starts_at, ends_at, area, format, players_needed, level_min, level_max, note)
  values ($1,$2,$3,'Ari','singles',3,4,6,'Rally then a set') returning id, players_needed`, [U.A, at(48), at(50)]);
assert.equal(P1.players_needed, 1); ok('singles post created (players needed forced to 1)');
await refused('past post refused', `insert into play_requests (author_id, starts_at, ends_at, area, level_min, level_max) values ($1,$2,$3,'Ari',4,6)`,
  [U.A, at(-2), at(-1)], /future/);
await refused('posting as someone else refused', `insert into play_requests (author_id, starts_at, ends_at, area, level_min, level_max) values ($1,$2,$3,'Ari',4,6)`,
  [U.B, at(48), at(50)], /row-level|safety/);
await refused('cannot set status on insert', `insert into play_requests (author_id, starts_at, ends_at, area, level_min, level_max, status) values ($1,$2,$3,'Ari',4,6,'filled')`,
  [U.A, at(48), at(50)], /permission denied/);

// --- visibility
await as(null);
await refused('signed-out visitors cannot see posts', `select * from play_requests`, [], /permission denied/);
await as(U.B);
assert.equal((await q(`select count(*)::int n from play_requests`))[0].n, 1); ok('signed-in players see open posts');

// --- asking
await refused('ask before safety tips refused', `select ask_to_play($1, 'hi')`, [P1.id], /safety/);
await db.exec('reset role'); await q(`update player_profiles set safety_ack_at = now() where id in ($1,$2,$3)`, [U.B, U.C, U.D]);
await as(U.B);
const convB = (await q(`select ask_to_play($1, 'I can do 7pm') id`, [P1.id]))[0].id;
assert.ok(convB); ok('player asks to play; direct chat opened');
assert.equal((await q(`select ask_to_play($1, 'again') id`, [P1.id]))[0].id, convB); ok('asking twice reuses the same ask');
assert.match((await q(`select body from messages where conversation_id = $1`, [convB]))[0].body, /Asked to play: Singles on .* in Ari\.\nI can do 7pm/);
ok('ask posted in the chat with the details');
await as(U.A);
await refused('author cannot ask own post', `select ask_to_play($1)`, [P1.id], /own post/);
assert.equal((await q(`select pending_count from play_requests where id=$1`, [P1.id]))[0].pending_count, 1);
assert.equal((await q(`select count(*)::int n from play_request_responses where request_id=$1`, [P1.id]))[0].n, 1); ok('author sees the ask');
assert.ok((await q(`select body from notifications where kind='play_ask'`)).length === 1); ok('author notified');
await as(U.C);
await q(`select ask_to_play($1, 'Me too')`, [P1.id]);
assert.equal((await q(`select count(*)::int n from play_request_responses`))[0].n, 1); ok("askers only see their own asks");
await refused('player cannot answer asks', `select answer_play_ask($1,$2,true)`, [P1.id, U.B], /author/);

// --- accept fills the singles post and declines the rest
await as(U.A);
const match = (await q(`select answer_play_ask($1,$2,true) id`, [P1.id, U.B]))[0].id;
assert.ok(match); ok('author accepts; match chat created');
let p = (await q(`select status, accepted_count, pending_count from play_requests where id=$1`, [P1.id]))[0];
assert.deepEqual([p.status, p.accepted_count, p.pending_count], ['filled', 1, 0]); ok('post filled when enough players accepted');
await as(U.C);
assert.equal((await q(`select status from play_request_responses where request_id=$1`, [P1.id]))[0].status, 'declined');
assert.ok((await q(`select body from notifications where kind='play_filled'`)).length === 1); ok('other askers told the post is full');
await refused('cannot ask a filled post', `select ask_to_play($1)`, [P1.id], /no longer open|already answered/);
await as(U.B);
assert.equal((await q(`select count(*)::int n from get_play_roster($1)`, [P1.id]))[0].n, 2); ok('accepted player sees the roster');
assert.equal((await q(`select kind::text from conversations where id=$1`, [match]))[0].kind, 'match');
assert.match((await q(`select title from my_conversations() where conversation_id=$1`, [match]))[0].title, /^Match: Singles on/); ok('match chat in the inbox');
await as(U.C);
assert.equal((await q(`select count(*)::int n from get_play_roster($1)`, [P1.id]))[0].n, 0); ok('others cannot see the roster');

// --- withdraw reopens
await as(U.B);
await q(`select withdraw_play_ask($1)`, [P1.id]);
await as(U.A);
p = (await q(`select status, accepted_count from play_requests where id=$1`, [P1.id]))[0];
assert.deepEqual([p.status, p.accepted_count], ['open', 0]); ok('withdrawing reopens the post');
assert.equal((await q(`select count(*)::int n from conversation_members where conversation_id=$1`, [match]))[0].n, 1); ok('withdrawn player leaves the match chat');

// --- doubles post, block, report
await as(U.D);
const [P2] = await q(`insert into play_requests (author_id, starts_at, ends_at, area, format, players_needed, level_min, level_max)
  values ($1,$2,$3,'Sathorn','doubles',3,4,6) returning id`, [U.D, at(72), at(74)]);
await as(U.B);
await q(`select ask_to_play($1)`, [P2.id]);
await as(U.D);
await q(`select answer_play_ask($1,$2,true)`, [P2.id, U.B]);
assert.equal((await q(`select status from play_requests where id=$1`, [P2.id]))[0].status, 'open'); ok('doubles post stays open until 3 players');
await q(`insert into user_blocks (blocker_id, blocked_id) values ($1, $2)`, [U.D, U.B]);
ok('author blocks a player');
assert.equal((await q(`select status from play_request_responses where request_id=$1 and user_id=$2`, [P2.id, U.B]))[0].status, 'declined');
assert.equal((await q(`select accepted_count from play_requests where id=$1`, [P2.id]))[0].accepted_count, 0); ok('blocked player removed from the match');
await as(U.B);
assert.equal((await q(`select count(*)::int n from play_requests where id=$1`, [P2.id]))[0].n, 0); ok('blocked player can no longer see the post');
await refused('blocked player cannot ask', `select ask_to_play($1)`, [P2.id], /not available/);
await refused('blocked player cannot start a chat', `select get_or_create_direct($1)`, [U.D], /cannot message/);
const directBD = (await q(`select id from conversations where kind='direct' and direct_key like $1`, [`%${U.D}%`]))[0]?.id;
if (directBD) await refused('blocked player cannot message an existing chat', `insert into messages (conversation_id, body) values ($1,'hey')`, [directBD], /row-level/);
await refused('block checks are not callable from the API', `select public.rallyz_blocked_with($1)`, [U.D], /does not exist/);
assert.equal((await q(`select count(*)::int n from my_conversations() where other_user_id = $1`, [U.D]))[0].n, 0); ok('blocked direct chat leaves the inbox');
await as(U.D);
assert.equal((await q(`select count(*)::int n from play_requests where id=$1`, [P1.id]))[0].n, 1);
await as(U.B);
assert.equal((await q(`select count(*)::int n from user_blocks`))[0].n, 0); ok("blocked player can't see the block list");
await as(U.D);
await q(`delete from user_blocks where blocked_id=$1`, [U.B]); ok('unblock');

await as(U.C);
await q(`select report_player($1, 'no_show', 'Did not turn up', $2)`, [U.D, P2.id]);
await refused('invalid report reason refused', `select report_player($1, 'bad_backhand')`, [U.D], /check/);
await refused('cannot report yourself', `select report_player($1, 'spam')`, [U.C], /Cannot report/);
await as(U.D);
assert.equal((await q(`select count(*)::int n from user_reports`))[0].n, 0); ok('reported player cannot see the report');
await as(U.M);
const [rep] = await q(`select id, reason from user_reports`);
assert.equal(rep.reason, 'no_show'); ok('admin sees the report');
assert.ok((await q(`select body from notifications where kind='report'`)).length === 1); ok('admin notified');
await q(`select resolve_report($1,'Warned the player')`, [rep.id]);
await as(U.C);
await refused('non-admin cannot resolve', `select resolve_report($1)`, [rep.id], /Admins/);

// --- cancel and limits
await as(U.C);
await q(`select ask_to_play($1)`, [P2.id]);
await as(U.D);
await q(`select cancel_play_request($1)`, [P2.id]);
await as(U.C);
assert.ok((await q(`select body from notifications where kind='play_cancelled'`)).length === 1); ok('askers told when a post is cancelled');
await refused('cannot ask a cancelled post', `select ask_to_play($1)`, [P2.id], /no longer open|already answered/);
await as(U.A);
for (let i = 0; i < 4; i++) {
  await q(`insert into play_requests (author_id, starts_at, ends_at, area, level_min, level_max) values ($1,$2,$3,'Ari',4,6)`, [U.A, at(100 + i), at(101 + i)]);
}
await refused('sixth open post refused', `insert into play_requests (author_id, starts_at, ends_at, area, level_min, level_max) values ($1,$2,$3,'Ari',4,6)`,
  [U.A, at(200), at(201)], /up to 5/);
await refused('author cannot reopen by editing status', `update play_requests set status='open' where id=$1`, [P2.id], /permission denied/);

// --- review fixes
await db.exec('reset role');
await q(`update play_requests set status = 'cancelled' where author_id = $1`, [U.A]);
await as(U.A);
const [P3] = await q(`insert into play_requests (author_id, starts_at, ends_at, area, format, level_min, level_max) values ($1,$2,$3,'Ari','singles',4,6) returning id`, [U.A, at(30), at(32)]);
await refused('authors cannot edit posts through the API', `update play_requests set starts_at = $2 where id = $1`, [P3.id, at(-5)], /permission denied/);

// ask/withdraw loop is capped
await as(U.B);
await q(`select ask_to_play($1)`, [P3.id]); await q(`select withdraw_play_ask($1)`, [P3.id]);
await q(`select ask_to_play($1)`, [P3.id]); await q(`select withdraw_play_ask($1)`, [P3.id]);
await refused('third ask after withdrawing twice refused', `select ask_to_play($1)`, [P3.id], /withdrawn from this post twice/);
await as(U.A);
assert.equal((await q(`select count(*)::int n from notifications where kind='play_ask' and link = $1`, ['/partner/' + P3.id]))[0].n, 2); ok('author got at most two ask alerts from the loop');

// players turned away by a fill can ask again when it reopens
const [P4] = await q(`insert into play_requests (author_id, starts_at, ends_at, area, format, level_min, level_max) values ($1,$2,$3,'Ari','singles',4,6) returning id`, [U.A, at(40), at(42)]);
await as(U.C); await q(`select ask_to_play($1)`, [P4.id]);
await as(U.D); await q(`select ask_to_play($1)`, [P4.id]);
await as(U.A); await q(`select answer_play_ask($1,$2,true)`, [P4.id, U.C]);
await as(U.C); await q(`select withdraw_play_ask($1)`, [P4.id]);
await as(U.D);
assert.ok((await q(`select body from notifications where kind='play_reopened'`)).length === 1); ok('turned-away player told the post reopened');
await q(`select ask_to_play($1, 'still free')`, [P4.id]); ok('and can ask again');

// group chat: blocked people stop seeing each other's messages
await as(U.A); await q(`select answer_play_ask($1,$2,true)`, [P4.id, U.D]);
const matchConv = (await q(`select id from conversations where play_request_id=$1`, [P4.id]))[0].id;
await db.exec('reset role');
await q(`insert into conversation_members (conversation_id, user_id) values ($1,$2)`, [matchConv, U.B]);
await as(U.B); await q(`insert into messages (conversation_id, body) values ($1,'hello from B')`, [matchConv]);
await as(U.D); await q(`insert into user_blocks (blocker_id, blocked_id) values ($1,$2)`, [U.D, U.B]);
assert.equal((await q(`select count(*)::int n from messages where conversation_id=$1 and sender_id=$2`, [matchConv, U.B]))[0].n, 0); ok("blocker no longer sees blocked player's group messages");
await as(U.B);
await q(`insert into messages (conversation_id, body) values ($1,'still here')`, [matchConv]);
await as(U.A);
assert.equal((await q(`select count(*)::int n from messages where conversation_id=$1 and sender_id=$2`, [matchConv, U.B]))[0].n, 2); ok('other members still see everyone');

// signed-out visitors don't see play times
await as(null);
await refused('anon cannot read play times', `select play_times from player_profiles`, [], /permission denied/);
assert.ok((await q(`select display_name from player_profiles limit 1`)).length === 1); ok('anon still sees names for event rosters');

// one open report per reporter and player; admins alerted once
await as(U.A); await q(`select report_player($1,'spam','first')`, [U.C]); await q(`select report_player($1,'harassment','second')`, [U.C]);
await as(U.B); await q(`select report_player($1,'spam','another person')`, [U.C]);
await as(U.M);
assert.equal((await q(`select count(*)::int n from user_reports where reported_id=$1 and status='open'`, [U.C]))[0].n, 2); ok('repeat reports from one person merged');
assert.equal((await q(`select details from user_reports where reported_id=$1 and reporter_id=$2`, [U.C, U.A]))[0].details, 'first\nsecond');
assert.equal((await q(`select count(*)::int n from notifications where kind='report' and body like '%Player C%'`))[0].n, 1); ok('admins alerted once per reported player');

console.log('\nALL PARTNER TESTS PASSED');
} catch (e) {
  console.error('FAILED:', e.message);
  process.exit(1);
}
