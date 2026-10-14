-- P2: find a partner.
--
-- A player posts when and where they want to play ("looking to play"), the
-- level range and how many players they need. Others ask to play; each ask
-- opens a direct chat with the author. The author accepts or declines; the
-- accepted players and the author share a match chat. When enough players
-- are accepted the post is filled.
--
-- Safety: posts are visible to signed-in players only; blocking hides posts
-- both ways, stops new asks and direct messages, and drops the blocked
-- person from the author's match; anyone can report a player or post to the
-- admins. Players confirm the safety tips before their first post or ask.

-- ---------------------------------------------------------------------------
-- Profile additions
-- ---------------------------------------------------------------------------

alter table public.player_profiles
  add column play_times text[] not null default '{}'
    check (play_times <@ array['weekday_morning', 'weekday_daytime', 'weekday_evening',
                               'weekend_morning', 'weekend_daytime', 'weekend_evening']::text[]),
  add column formats text[] not null default '{}'
    check (formats <@ array['singles', 'doubles', 'mixed']::text[]),
  add column safety_ack_at timestamptz;

grant update (play_times, formats, safety_ack_at) on public.player_profiles to authenticated;

-- When and where someone usually plays is for signed-in players only.
revoke select on public.player_profiles from anon;
grant select (id, display_name, avatar_url, level, is_founding_organizer) on public.player_profiles to anon;

-- ---------------------------------------------------------------------------
-- Blocks
-- ---------------------------------------------------------------------------

create table public.user_blocks (
  blocker_id uuid not null references public.player_profiles (id) on delete cascade,
  blocked_id uuid not null references public.player_profiles (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (blocker_id, blocked_id),
  check (blocker_id <> blocked_id)
);

create index user_blocks_blocked_idx on public.user_blocks (blocked_id);

alter table public.user_blocks enable row level security;

create policy "users see their blocks" on public.user_blocks
  for select to authenticated using (blocker_id = auth.uid());
create policy "users block" on public.user_blocks
  for insert to authenticated with check (blocker_id = auth.uid());
create policy "users unblock" on public.user_blocks
  for delete to authenticated using (blocker_id = auth.uid());

revoke all on public.user_blocks from anon;
revoke update on public.user_blocks from authenticated;

-- Block checks live in a schema the API does not expose, so policies can use
-- them but nobody can call them to find out who blocked whom.
create schema if not exists rallyz_private;
revoke all on schema rallyz_private from public;
grant usage on schema rallyz_private to authenticated;

-- True if either person has blocked the other.
create function rallyz_private.blocked_between(a uuid, b uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.user_blocks
    where (blocker_id = a and blocked_id = b) or (blocker_id = b and blocked_id = a)
  );
$$;

create function rallyz_private.blocked_with(p_other uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select rallyz_private.blocked_between(auth.uid(), p_other);
$$;

revoke execute on all functions in schema rallyz_private from public;

-- ---------------------------------------------------------------------------
-- Posts and asks
-- ---------------------------------------------------------------------------

create type public.play_request_status as enum ('open', 'filled', 'cancelled');
create type public.play_ask_status as enum ('pending', 'accepted', 'declined', 'withdrawn');

create table public.play_requests (
  id uuid primary key default gen_random_uuid(),
  author_id uuid not null references public.player_profiles (id) on delete cascade,
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  area text not null,
  venue_id uuid references public.venues (id) on delete set null,
  venue_name text check (char_length(venue_name) <= 120),
  court_booked boolean not null default false,
  format public.play_format not null default 'singles',
  players_needed smallint not null default 1 check (players_needed between 1 and 3),
  level_min smallint not null check (level_min between 1 and 9),
  level_max smallint not null check (level_max between 1 and 9),
  note text not null default '' check (char_length(note) <= 500),
  status public.play_request_status not null default 'open',
  accepted_count smallint not null default 0,
  pending_count smallint not null default 0,
  created_at timestamptz not null default now(),
  check (ends_at > starts_at),
  check (ends_at - starts_at <= interval '12 hours'),
  check (level_max >= level_min)
);

create index play_requests_open_idx on public.play_requests (starts_at) where status = 'open';
create index play_requests_author_idx on public.play_requests (author_id, starts_at);

create table public.play_request_responses (
  request_id uuid not null references public.play_requests (id) on delete cascade,
  user_id uuid not null references public.player_profiles (id) on delete cascade,
  message text not null default '' check (char_length(message) <= 500),
  status public.play_ask_status not null default 'pending',
  conversation_id uuid references public.conversations (id) on delete set null,
  -- Declined only because the post filled; may ask again if it reopens.
  closed_by_fill boolean not null default false,
  times_withdrawn smallint not null default 0,
  last_asked_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (request_id, user_id)
);

create index play_request_responses_user_idx on public.play_request_responses (user_id, created_at desc);

-- A match chat belongs to one post.
alter table public.conversations
  add column play_request_id uuid unique references public.play_requests (id) on delete cascade,
  add constraint conversations_match_check check ((kind = 'match') = (play_request_id is not null));

alter table public.play_requests enable row level security;
alter table public.play_request_responses enable row level security;

-- Signed-in players only (a post says where someone will be), and never
-- between people who blocked each other.
create policy "signed-in players see posts" on public.play_requests
  for select to authenticated using (
    author_id = auth.uid() or not rallyz_private.blocked_with(author_id)
  );

create policy "players create their posts" on public.play_requests
  for insert to authenticated with check (author_id = auth.uid());

revoke all on public.play_requests from anon;
revoke insert, update, delete on public.play_requests from authenticated;
grant insert (author_id, starts_at, ends_at, area, venue_id, venue_name, court_booked, format, players_needed,
              level_min, level_max, note)
  on public.play_requests to authenticated;

create policy "askers see their asks" on public.play_request_responses
  for select to authenticated using (user_id = auth.uid());
create policy "authors see asks on their posts" on public.play_request_responses
  for select to authenticated using (
    exists (select 1 from public.play_requests r where r.id = request_id and r.author_id = auth.uid())
  );

revoke all on public.play_request_responses from anon;
revoke insert, update, delete on public.play_request_responses from authenticated;

-- Limits and the safety confirmation, checked on every new post.
create function public.rallyz_check_new_play_request() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if (select safety_ack_at from public.player_profiles where id = new.author_id) is null then
    raise exception 'Read and accept the safety tips before posting' using errcode = 'P0001';
  end if;
  if new.starts_at <= now() then
    raise exception 'Pick a time in the future' using errcode = 'P0001';
  end if;
  if new.starts_at > now() + interval '60 days' then
    raise exception 'Posts can be up to 60 days ahead' using errcode = 'P0001';
  end if;
  if (select count(*) from public.play_requests
      where author_id = new.author_id and status = 'open' and ends_at > now()) >= 5 then
    raise exception 'You can have up to 5 open posts at a time' using errcode = 'P0001';
  end if;
  if new.players_needed > 1 and new.format = 'singles' then
    new.players_needed := 1; -- singles needs exactly one opponent
  end if;
  return new;
end;
$$;

create trigger rallyz_check_new_play_request
  before insert on public.play_requests
  for each row execute function public.rallyz_check_new_play_request();

-- ---------------------------------------------------------------------------
-- Reports
-- ---------------------------------------------------------------------------

create type public.report_status as enum ('open', 'resolved');

create table public.user_reports (
  id uuid primary key default gen_random_uuid(),
  reporter_id uuid not null references public.player_profiles (id) on delete cascade,
  reported_id uuid not null references public.player_profiles (id) on delete cascade,
  play_request_id uuid references public.play_requests (id) on delete set null,
  reason text not null check (reason in ('no_show', 'harassment', 'inappropriate', 'spam', 'safety', 'other')),
  details text not null default '' check (char_length(details) <= 1000),
  status public.report_status not null default 'open',
  admin_note text,
  created_at timestamptz not null default now(),
  resolved_at timestamptz,
  check (reporter_id <> reported_id)
);

create index user_reports_status_idx on public.user_reports (status, created_at desc);
create unique index user_reports_one_open on public.user_reports (reporter_id, reported_id) where status = 'open';

alter table public.user_reports enable row level security;
create policy "reporters see their reports" on public.user_reports
  for select to authenticated using (reporter_id = auth.uid() or public.rallyz_is_admin());
revoke all on public.user_reports from anon;
revoke insert, update, delete on public.user_reports from authenticated;

-- ---------------------------------------------------------------------------
-- Internal helpers
-- ---------------------------------------------------------------------------

create function public._recount_play_request(p_request uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  update public.play_requests r set
    accepted_count = (select count(*) from public.play_request_responses x where x.request_id = r.id and x.status = 'accepted'),
    pending_count  = (select count(*) from public.play_request_responses x where x.request_id = r.id and x.status = 'pending')
  where r.id = p_request;
end;
$$;

create function public._match_conversation(p_request uuid) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_conv uuid;
  v_author uuid;
begin
  select id into v_conv from public.conversations where play_request_id = p_request;
  if v_conv is null then
    select author_id into v_author from public.play_requests where id = p_request;
    insert into public.conversations (kind, play_request_id) values ('match', p_request)
      on conflict (play_request_id) do nothing
      returning id into v_conv;
    if v_conv is null then
      select id into v_conv from public.conversations where play_request_id = p_request;
    end if;
    insert into public.conversation_members (conversation_id, user_id) values (v_conv, v_author)
      on conflict do nothing;
  end if;
  return v_conv;
end;
$$;

create function public._post_label(r public.play_requests) returns text
language sql stable set search_path = public as $$
  select initcap(r.format::text) || ' on ' ||
         to_char(r.starts_at at time zone 'Asia/Bangkok', 'Dy DD Mon, HH24:MI') || ' in ' || r.area;
$$;

-- ---------------------------------------------------------------------------
-- Player actions
-- ---------------------------------------------------------------------------

-- Ask to play. Opens (or reuses) a direct chat with the author and posts the
-- ask there. Returns the conversation id.
create function public.ask_to_play(p_request uuid, p_message text default '') returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  v_req public.play_requests;
  v_existing public.play_request_responses;
  v_conv uuid;
  v_msg text := left(btrim(coalesce(p_message, '')), 500);
begin
  if v_uid is null then
    raise exception 'Sign in first' using errcode = '28000';
  end if;
  if (select safety_ack_at from public.player_profiles where id = v_uid) is null then
    raise exception 'Read and accept the safety tips first' using errcode = 'P0001';
  end if;

  select * into v_req from public.play_requests where id = p_request for update;
  if not found or rallyz_private.blocked_between(v_req.author_id, v_uid) then
    raise exception 'This post is not available' using errcode = 'P0002';
  end if;
  if v_req.author_id = v_uid then
    raise exception 'This is your own post' using errcode = 'P0001';
  end if;
  if v_req.status <> 'open' or v_req.starts_at <= now() then
    raise exception 'This post is no longer open' using errcode = 'P0001';
  end if;

  select * into v_existing from public.play_request_responses where request_id = p_request and user_id = v_uid;
  if found and v_existing.status in ('pending', 'accepted') then
    return v_existing.conversation_id;
  end if;
  if found and v_existing.status = 'declined' and not v_existing.closed_by_fill then
    raise exception 'The player has already answered your ask' using errcode = 'P0001';
  end if;
  if found and v_existing.status = 'withdrawn' and v_existing.times_withdrawn >= 2 then
    raise exception 'You have withdrawn from this post twice. Message the player instead.' using errcode = 'P0001';
  end if;

  if (select count(*) from public.play_request_responses
      where user_id = v_uid and last_asked_at > now() - interval '1 day') >= 20 then
    raise exception 'Too many asks today. Try again tomorrow.' using errcode = 'P0001';
  end if;

  v_conv := public.get_or_create_direct(v_req.author_id);

  insert into public.play_request_responses (request_id, user_id, message, status, conversation_id)
  values (p_request, v_uid, v_msg, 'pending', v_conv)
  on conflict (request_id, user_id) do update
    set message = excluded.message, status = 'pending', conversation_id = excluded.conversation_id,
        closed_by_fill = false, last_asked_at = now(), updated_at = now();

  insert into public.messages (conversation_id, sender_id, body)
  values (v_conv, v_uid, 'Asked to play: ' || public._post_label(v_req) || '.' ||
          case when v_msg <> '' then E'\n' || v_msg else '' end);

  perform public._recount_play_request(p_request);
  perform public._notify(v_req.author_id, 'play_ask',
    public._display_name(v_uid) || ' wants to play: ' || public._post_label(v_req) || '.',
    null, v_uid, '/partner/' || p_request);
  return v_conv;
end;
$$;

-- Author accepts or declines an ask. Returns the match chat id on accept.
create function public.answer_play_ask(p_request uuid, p_user uuid, p_accept boolean) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_req public.play_requests;
  v_ask public.play_request_responses;
  v_conv uuid;
  v_other record;
begin
  select * into v_req from public.play_requests where id = p_request for update;
  if not found or v_req.author_id is distinct from auth.uid() then
    raise exception 'Only the author can answer asks' using errcode = '42501';
  end if;
  select * into v_ask from public.play_request_responses where request_id = p_request and user_id = p_user;
  if not found or v_ask.status <> 'pending' then
    raise exception 'That ask is no longer pending' using errcode = 'P0001';
  end if;

  if not p_accept then
    update public.play_request_responses set status = 'declined', updated_at = now()
      where request_id = p_request and user_id = p_user;
    perform public._recount_play_request(p_request);
    perform public._notify(p_user, 'play_declined',
      public._display_name(v_req.author_id) || ' has found other players for ' || public._post_label(v_req) || '.',
      null, v_req.author_id, '/partner');
    return null;
  end if;

  if v_req.status <> 'open' or v_req.starts_at <= now() then
    raise exception 'This post is no longer open' using errcode = 'P0001';
  end if;
  if rallyz_private.blocked_between(v_req.author_id, p_user) then
    raise exception 'You cannot play with this player' using errcode = 'P0001';
  end if;

  update public.play_request_responses set status = 'accepted', updated_at = now()
    where request_id = p_request and user_id = p_user;
  v_conv := public._match_conversation(p_request);
  insert into public.conversation_members (conversation_id, user_id) values (v_conv, p_user) on conflict do nothing;
  insert into public.messages (conversation_id, sender_id, body)
  values (v_conv, v_req.author_id, public._display_name(p_user) || ' is in. ' || public._post_label(v_req) || '.');
  perform public._recount_play_request(p_request);
  perform public._notify(p_user, 'play_accepted',
    public._display_name(v_req.author_id) || ' accepted you for ' || public._post_label(v_req) || '.',
    null, v_req.author_id, '/chat/' || v_conv);

  -- Filled: close the post and let the other askers know.
  if (select accepted_count from public.play_requests where id = p_request) >= v_req.players_needed then
    update public.play_requests set status = 'filled' where id = p_request;
    for v_other in
      select user_id from public.play_request_responses where request_id = p_request and status = 'pending'
    loop
      update public.play_request_responses set status = 'declined', closed_by_fill = true, updated_at = now()
        where request_id = p_request and user_id = v_other.user_id;
      perform public._notify(v_other.user_id, 'play_filled',
        'The post for ' || public._post_label(v_req) || ' is now full.', null, v_req.author_id, '/partner');
    end loop;
    perform public._recount_play_request(p_request);
  end if;
  return v_conv;
end;
$$;

-- Asker withdraws (pending or accepted). Reopens a filled post.
create function public.withdraw_play_ask(p_request uuid) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  v_req public.play_requests;
  v_ask public.play_request_responses;
begin
  select * into v_req from public.play_requests where id = p_request for update;
  select * into v_ask from public.play_request_responses where request_id = p_request and user_id = v_uid;
  if v_req.id is null or v_ask.request_id is null or v_ask.status not in ('pending', 'accepted') then
    raise exception 'You have no active ask on this post' using errcode = 'P0001';
  end if;
  update public.play_request_responses
    set status = 'withdrawn', times_withdrawn = times_withdrawn + 1, updated_at = now()
    where request_id = p_request and user_id = v_uid;
  if v_ask.status = 'accepted' then
    delete from public.conversation_members cm
      using public.conversations c
      where c.id = cm.conversation_id and c.play_request_id = p_request and cm.user_id = v_uid;
    if v_req.status = 'filled' and v_req.starts_at > now() then
      update public.play_requests set status = 'open' where id = p_request;
      perform public._notify(x.user_id, 'play_reopened',
        'A spot opened up again: ' || public._post_label(v_req) || '. Ask again if you can still play.',
        null, v_req.author_id, '/partner/' || p_request)
      from public.play_request_responses x
      where x.request_id = p_request and x.closed_by_fill and x.status = 'declined';
    end if;
    perform public._notify(v_req.author_id, 'play_withdrawn',
      public._display_name(v_uid) || ' can no longer play ' || public._post_label(v_req) || '.' ||
      case when v_req.status = 'filled' and v_req.starts_at > now() then ' Your post is open again.' else '' end,
      null, v_uid, '/partner/' || p_request);
  end if;
  perform public._recount_play_request(p_request);
end;
$$;

create function public.cancel_play_request(p_request uuid) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_req public.play_requests;
  v_p record;
begin
  select * into v_req from public.play_requests where id = p_request for update;
  if not found or v_req.author_id is distinct from auth.uid() then
    raise exception 'Only the author can cancel this post' using errcode = '42501';
  end if;
  if v_req.status = 'cancelled' then
    return;
  end if;
  update public.play_requests set status = 'cancelled' where id = p_request;
  for v_p in
    select user_id from public.play_request_responses where request_id = p_request and status in ('pending', 'accepted')
  loop
    perform public._notify(v_p.user_id, 'play_cancelled',
      public._display_name(v_req.author_id) || ' cancelled ' || public._post_label(v_req) || '.', null, v_req.author_id, '/partner');
  end loop;
  update public.play_request_responses set status = 'declined', updated_at = now()
    where request_id = p_request and status = 'pending';
  perform public._recount_play_request(p_request);
end;
$$;

-- Players in a post: the author and accepted players. Visible to the author
-- and to accepted players only.
create function public.get_play_roster(p_request uuid)
returns table (user_id uuid, display_name text, avatar_url text, level smallint, is_author boolean)
language sql stable security definer set search_path = public as $$
  with r as (select * from public.play_requests where id = p_request)
  select p.id, p.display_name, p.avatar_url, p.level, true
  from r join public.player_profiles p on p.id = r.author_id
  where auth.uid() = r.author_id
     or exists (select 1 from public.play_request_responses x
                where x.request_id = r.id and x.user_id = auth.uid() and x.status = 'accepted')
  union all
  select p.id, p.display_name, p.avatar_url, p.level, false
  from r join public.play_request_responses x on x.request_id = r.id and x.status = 'accepted'
  join public.player_profiles p on p.id = x.user_id
  where auth.uid() = r.author_id
     or exists (select 1 from public.play_request_responses y
                where y.request_id = r.id and y.user_id = auth.uid() and y.status = 'accepted');
$$;

-- ---------------------------------------------------------------------------
-- Blocking
-- ---------------------------------------------------------------------------

-- Blocking someone also ends anything open between you: their asks on your
-- posts and yours on theirs are declined, and they leave your match chats.
create function public.rallyz_apply_block() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_x record;
begin
  for v_x in
    select x.request_id, x.user_id, x.status, r.status as req_status, r.starts_at
    from public.play_request_responses x
    join public.play_requests r on r.id = x.request_id
    where x.status in ('pending', 'accepted')
      and ((r.author_id = new.blocker_id and x.user_id = new.blocked_id)
        or (r.author_id = new.blocked_id and x.user_id = new.blocker_id))
  loop
    update public.play_request_responses set status = 'declined', updated_at = now()
      where request_id = v_x.request_id and user_id = v_x.user_id;
    if v_x.status = 'accepted' then
      delete from public.conversation_members cm
        using public.conversations c
        where c.id = cm.conversation_id and c.play_request_id = v_x.request_id and cm.user_id = v_x.user_id;
      if v_x.req_status = 'filled' and v_x.starts_at > now() then
        update public.play_requests set status = 'open' where id = v_x.request_id;
      end if;
    end if;
    perform public._recount_play_request(v_x.request_id);
  end loop;
  return new;
end;
$$;

create trigger rallyz_apply_block
  after insert on public.user_blocks
  for each row execute function public.rallyz_apply_block();

-- No new direct chats with someone you blocked, or who blocked you.
create or replace function public.get_or_create_direct(p_other uuid) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  v_key text;
  v_conv uuid;
begin
  if v_uid is null then
    raise exception 'Sign in first' using errcode = '28000';
  end if;
  if p_other is null or p_other = v_uid or not exists (select 1 from public.player_profiles where id = p_other) then
    raise exception 'Cannot start that conversation' using errcode = 'P0001';
  end if;
  if rallyz_private.blocked_between(v_uid, p_other) then
    raise exception 'You cannot message this player' using errcode = 'P0001';
  end if;
  v_key := least(v_uid::text, p_other::text) || ':' || greatest(v_uid::text, p_other::text);
  select id into v_conv from public.conversations where direct_key = v_key;
  if v_conv is null then
    insert into public.conversations (kind, direct_key) values ('direct', v_key)
      on conflict (direct_key) do nothing
      returning id into v_conv;
    if v_conv is null then
      select id into v_conv from public.conversations where direct_key = v_key;
    end if;
    insert into public.conversation_members (conversation_id, user_id)
      values (v_conv, v_uid), (v_conv, p_other)
      on conflict do nothing;
  end if;
  return v_conv;
end;
$$;

-- Messages in a direct chat stop once either person blocks the other.
create function rallyz_private.can_post(conv uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select public.is_conversation_member(conv)
     and not exists (
       select 1 from public.conversations c
       join public.conversation_members m on m.conversation_id = c.id and m.user_id <> auth.uid()
       where c.id = conv and c.kind = 'direct' and rallyz_private.blocked_between(auth.uid(), m.user_id)
     );
$$;
revoke execute on function rallyz_private.can_post(uuid) from public;
grant execute on function rallyz_private.can_post(uuid) to authenticated;

drop policy if exists "members read messages" on public.messages;
create policy "members read messages" on public.messages
  for select to authenticated using (
    public.is_conversation_member(conversation_id)
    and (sender_id = auth.uid() or not rallyz_private.blocked_with(sender_id))
  );

drop policy if exists "members send messages" on public.messages;
create policy "members send messages" on public.messages
  for insert to authenticated with check (sender_id = auth.uid() and rallyz_private.can_post(conversation_id));

-- Inbox: match chats are titled after the post.
create or replace function public.my_conversations()
returns table (conversation_id uuid, kind public.conversation_kind, event_id uuid, title text,
               other_user_id uuid, other_avatar_url text, last_message text, last_message_at timestamptz,
               unread integer)
language sql stable security definer set search_path = public as $$
  select c.id, c.kind, c.event_id,
    case
      when c.kind = 'event' then e.title
      when c.kind = 'match' then 'Match: ' || public._post_label(pr)
      else coalesce(nullif(op.display_name, ''), 'Player')
    end,
    o.user_id, op.avatar_url,
    lm.body, c.last_message_at,
    (select count(*)::int from public.messages m2
      where m2.conversation_id = c.id and m2.created_at > me.last_read_at and m2.sender_id <> me.user_id)
  from public.conversation_members me
  join public.conversations c on c.id = me.conversation_id
  left join public.events e on e.id = c.event_id
  left join public.play_requests pr on pr.id = c.play_request_id
  left join lateral (
    select m.user_id from public.conversation_members m
    where m.conversation_id = c.id and m.user_id <> me.user_id and c.kind = 'direct' limit 1
  ) o on true
  left join public.player_profiles op on op.id = o.user_id
  left join lateral (
    select body from public.messages m where m.conversation_id = c.id order by m.created_at desc limit 1
  ) lm on true
  where me.user_id = auth.uid()
    and not (c.kind = 'direct' and o.user_id is not null and rallyz_private.blocked_between(me.user_id, o.user_id))
  order by c.last_message_at desc;
$$;

-- ---------------------------------------------------------------------------
-- Reports
-- ---------------------------------------------------------------------------

create function public.report_player(p_user uuid, p_reason text, p_details text default '', p_request uuid default null)
returns void
language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  v_admin record;
  v_inserted boolean;
begin
  if v_uid is null then
    raise exception 'Sign in first' using errcode = '28000';
  end if;
  if p_user is null or p_user = v_uid or not exists (select 1 from public.player_profiles where id = p_user) then
    raise exception 'Cannot report that player' using errcode = 'P0001';
  end if;
  if (select count(*) from public.user_reports where reporter_id = v_uid and created_at > now() - interval '1 day') >= 10 then
    raise exception 'Too many reports today. Contact us directly if this is urgent.' using errcode = 'P0001';
  end if;
  insert into public.user_reports (reporter_id, reported_id, play_request_id, reason, details)
  values (v_uid, p_user, p_request, p_reason, left(coalesce(p_details, ''), 1000))
  on conflict (reporter_id, reported_id) where status = 'open'
  do update set reason = excluded.reason,
    details = left(public.user_reports.details || case when excluded.details <> '' then E'\n' || excluded.details else '' end, 1000),
    play_request_id = coalesce(excluded.play_request_id, public.user_reports.play_request_id)
  returning (xmax = 0) into v_inserted; -- false when an existing open report was updated
  -- Alert admins once per reported player until their reports are resolved.
  if not v_inserted
     or (select count(*) from public.user_reports where reported_id = p_user and status = 'open') > 1 then
    return;
  end if;
  for v_admin in select user_id from public.app_admins loop
    perform public._notify(v_admin.user_id, 'report', 'New report about ' || public._display_name(p_user) || ' (' || p_reason || ').',
      null, null, '/admin#reports');
  end loop;
end;
$$;

create function public.resolve_report(p_report uuid, p_note text default null) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.rallyz_is_admin() then
    raise exception 'Admins only' using errcode = '42501';
  end if;
  update public.user_reports set status = 'resolved', admin_note = left(p_note, 500), resolved_at = now()
    where id = p_report;
end;
$$;

-- ---------------------------------------------------------------------------
-- Who may call what (Rallyz functions only)
-- ---------------------------------------------------------------------------

revoke execute on function public.rallyz_check_new_play_request() from public, anon, authenticated;
revoke execute on function public._recount_play_request(uuid) from public, anon, authenticated;
revoke execute on function public._match_conversation(uuid) from public, anon, authenticated;
revoke execute on function public._post_label(public.play_requests) from public, anon, authenticated;
revoke execute on function public.ask_to_play(uuid, text) from public, anon, authenticated;
revoke execute on function public.answer_play_ask(uuid, uuid, boolean) from public, anon, authenticated;
revoke execute on function public.withdraw_play_ask(uuid) from public, anon, authenticated;
revoke execute on function public.cancel_play_request(uuid) from public, anon, authenticated;
revoke execute on function public.get_play_roster(uuid) from public, anon, authenticated;
revoke execute on function public.rallyz_apply_block() from public, anon, authenticated;
revoke execute on function public.report_player(uuid, text, text, uuid) from public, anon, authenticated;
revoke execute on function public.resolve_report(uuid, text) from public, anon, authenticated;

grant execute on function rallyz_private.blocked_with(uuid) to authenticated;
grant execute on function public.ask_to_play(uuid, text) to authenticated;
grant execute on function public.answer_play_ask(uuid, uuid, boolean) to authenticated;
grant execute on function public.withdraw_play_ask(uuid) to authenticated;
grant execute on function public.cancel_play_request(uuid) to authenticated;
grant execute on function public.get_play_roster(uuid) to authenticated;
grant execute on function public.report_player(uuid, text, text, uuid) to authenticated;
grant execute on function public.resolve_report(uuid, text) to authenticated;
