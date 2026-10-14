-- Rallyz core schema: profiles, events, participation, payments, chat,
-- notifications, instructors and lesson requests.
--
-- Security model
--   * Every table has row level security on.
--   * Clients read through RLS policies and write only the columns granted
--     to them. Anything that changes more than one row, or that must not be
--     forged (participation status, counters, waitlist order, payments,
--     coach approval), goes through SECURITY DEFINER functions below, which
--     check the caller themselves.


-- ---------------------------------------------------------------------------
-- Types
-- ---------------------------------------------------------------------------

create type public.event_type as enum ('practice', 'match_play', 'lesson', 'tournament', 'social');
create type public.play_format as enum ('singles', 'doubles', 'mixed');
create type public.entry_mode as enum ('instant', 'approval');
create type public.participant_status as enum ('pending', 'confirmed', 'waitlisted', 'declined', 'cancelled');
create type public.payment_status as enum ('unpaid', 'claimed', 'paid');
create type public.coach_status as enum ('pending', 'approved', 'rejected');
create type public.lesson_kind as enum ('private', 'group');
create type public.lesson_request_status as enum ('pending', 'accepted', 'declined', 'cancelled');
create type public.conversation_kind as enum ('direct', 'event');

-- ---------------------------------------------------------------------------
-- Player profiles
--
-- The project's existing public.profiles table holds private details (phone)
-- and stays untouched. Rallyz keeps its own table with only fields that are
-- safe to show other players.
-- ---------------------------------------------------------------------------

create table public.player_profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  display_name text not null default '' check (char_length(display_name) <= 60),
  avatar_url text check (avatar_url is null or (avatar_url ~ '^https://' and char_length(avatar_url) <= 500)),
  level smallint check (level between 1 and 9),
  areas text[] not null default '{}',
  bio text not null default '' check (char_length(bio) <= 500),
  onboarded boolean not null default false,
  is_founding_organizer boolean not null default false,
  created_at timestamptz not null default now()
);

alter table public.player_profiles enable row level security;

create policy "player profiles are public" on public.player_profiles
  for select using (true);

create policy "users update their own profile" on public.player_profiles
  for update to authenticated
  using (id = auth.uid()) with check (id = auth.uid());

-- Users may only touch their own editable columns; the Founding Organizer
-- badge is set by admins.
revoke insert, update, delete on public.player_profiles from anon, authenticated;
grant update (display_name, avatar_url, level, areas, bio, onboarded) on public.player_profiles to authenticated;

-- Create a profile row for every new auth user.
create function public.rallyz_handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into public.player_profiles (id, display_name, avatar_url)
  values (
    new.id,
    left(coalesce(new.raw_user_meta_data ->> 'full_name', new.raw_user_meta_data ->> 'name', split_part(coalesce(new.email, ''), '@', 1), ''), 60),
    case when (new.raw_user_meta_data ->> 'avatar_url') ~ '^https://' then left(new.raw_user_meta_data ->> 'avatar_url', 500) end
  )
  on conflict (id) do nothing;
  return new;
exception when others then
  -- Never block a sign-up on the main site because of Rallyz. The profile is
  -- created later by the backfill or on first visit to onboarding.
  raise warning 'rallyz_handle_new_user failed for %: %', new.id, sqlerrm;
  return new;
end;
$$;

create trigger rallyz_on_auth_user_created
  after insert on auth.users
  for each row execute function public.rallyz_handle_new_user();

-- People who signed up on the main site before Rallyz existed get a player
-- profile too, named from the main site's profiles.full_name when there is
-- one (they set their level in onboarding the first time they visit).
do $$
begin
  if to_regclass('public.profiles') is not null then
    execute $q$
      insert into public.player_profiles (id, display_name, avatar_url)
      select u.id,
        left(coalesce(nullif(p.full_name, ''), u.raw_user_meta_data ->> 'full_name', u.raw_user_meta_data ->> 'name',
                      split_part(coalesce(u.email, ''), '@', 1), ''), 60),
        case when (u.raw_user_meta_data ->> 'avatar_url') ~ '^https://' then left(u.raw_user_meta_data ->> 'avatar_url', 500) end
      from auth.users u
      left join public.profiles p on p.id = u.id
      on conflict (id) do nothing
    $q$;
  else
    insert into public.player_profiles (id, display_name, avatar_url)
    select u.id,
      left(coalesce(u.raw_user_meta_data ->> 'full_name', u.raw_user_meta_data ->> 'name', split_part(coalesce(u.email, ''), '@', 1), ''), 60),
      case when (u.raw_user_meta_data ->> 'avatar_url') ~ '^https://' then left(u.raw_user_meta_data ->> 'avatar_url', 500) end
    from auth.users u
    on conflict (id) do nothing;
  end if;
end;
$$;

-- Admins, by user id. Seeded from the main site's existing rule (the admin
-- email in the claims/venues policies). Add more with:
--   insert into public.app_admins (user_id) select id from auth.users where email = '...';
create table if not exists public.app_admins (
  user_id uuid primary key references auth.users (id) on delete cascade,
  created_at timestamptz not null default now()
);
alter table public.app_admins enable row level security;
revoke all on public.app_admins from anon, authenticated;

insert into public.app_admins (user_id)
select id from auth.users where lower(email) = 'zoloyunho1@gmail.com'
on conflict do nothing;

create function public.rallyz_is_admin(uid uuid default auth.uid()) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.app_admins where user_id = uid);
$$;

-- Where organizers receive PromptPay payments. Private to the owner; shown to
-- confirmed participants only through get_payment_info().
create table public.organizer_settings (
  user_id uuid primary key references public.player_profiles (id) on delete cascade,
  promptpay_id text check (promptpay_id ~ '^(0[0-9]{9}|[0-9]{13})$'),
  updated_at timestamptz not null default now()
);

alter table public.organizer_settings enable row level security;

create policy "owner reads settings" on public.organizer_settings
  for select to authenticated using (user_id = auth.uid());
create policy "owner inserts settings" on public.organizer_settings
  for insert to authenticated with check (user_id = auth.uid());
create policy "owner updates settings" on public.organizer_settings
  for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());

revoke all on public.organizer_settings from anon;

-- ---------------------------------------------------------------------------
-- Events
-- ---------------------------------------------------------------------------

create table public.events (
  id uuid primary key default gen_random_uuid(),
  organizer_id uuid not null references public.player_profiles (id) on delete cascade,
  sport text not null default 'tennis',
  type public.event_type not null default 'practice',
  title text not null check (char_length(title) between 3 and 120),
  description text not null default '' check (char_length(description) <= 5000),
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  venue_id uuid references public.venues (id) on delete set null,
  venue_name text not null check (char_length(venue_name) between 2 and 120),
  area text not null,
  address text check (char_length(address) <= 300),
  courts smallint check (courts between 1 and 50),
  level_min smallint not null check (level_min between 1 and 9),
  level_max smallint not null check (level_max between 1 and 9),
  fee_thb integer not null default 0 check (fee_thb between 0 and 100000),
  capacity smallint not null check (capacity between 1 and 200),
  format public.play_format not null default 'doubles',
  entry_mode public.entry_mode not null default 'instant',
  cancel_deadline_hours smallint not null default 24 check (cancel_deadline_hours between 0 and 168),
  cancellation_policy text not null default '' check (char_length(cancellation_policy) <= 1000),
  series_id uuid,
  confirmed_count smallint not null default 0,
  waitlist_count smallint not null default 0,
  pending_count smallint not null default 0,
  spots_left smallint generated always as (capacity - confirmed_count) stored,
  cancelled_at timestamptz,
  reminder_sent_at timestamptz,
  created_at timestamptz not null default now(),
  check (ends_at > starts_at),
  check (level_max >= level_min)
);

create index events_upcoming_idx on public.events (starts_at) where cancelled_at is null;
create index events_organizer_idx on public.events (organizer_id, starts_at);
create index events_series_idx on public.events (series_id);
create index events_venue_idx on public.events (venue_id, starts_at);
create index events_area_idx on public.events (area, starts_at) where cancelled_at is null;

alter table public.events enable row level security;

create policy "events are public" on public.events
  for select using (true);

create policy "organizers create their events" on public.events
  for insert to authenticated with check (organizer_id = auth.uid());

create policy "organizers edit their events" on public.events
  for update to authenticated
  using (organizer_id = auth.uid() and cancelled_at is null)
  with check (organizer_id = auth.uid());

-- Counters, cancellation and reminders are owned by the functions below.
revoke insert, update, delete on public.events from anon, authenticated;
grant insert (id, organizer_id, sport, type, title, description, starts_at, ends_at, venue_id, venue_name, area, address,
              courts, level_min, level_max, fee_thb, capacity, format, entry_mode, cancel_deadline_hours,
              cancellation_policy, series_id)
  on public.events to authenticated;
grant update (type, title, description, starts_at, ends_at, venue_id, venue_name, area, address, courts, level_min,
              level_max, fee_thb, capacity, format, entry_mode, cancel_deadline_hours, cancellation_policy)
  on public.events to authenticated;

-- Meeting point and other details only confirmed players see.
create table public.event_private_notes (
  event_id uuid primary key references public.events (id) on delete cascade,
  note text not null default '' check (char_length(note) <= 2000)
);

alter table public.event_private_notes enable row level security;

create table public.event_participants (
  event_id uuid not null references public.events (id) on delete cascade,
  user_id uuid not null references public.player_profiles (id) on delete cascade,
  status public.participant_status not null,
  payment_status public.payment_status not null default 'unpaid',
  queued_at timestamptz not null default now(),
  cancelled_late boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (event_id, user_id)
);

create index event_participants_user_idx on public.event_participants (user_id, status);
create index event_participants_queue_idx on public.event_participants (event_id, status, queued_at);

alter table public.event_participants enable row level security;

create policy "players see their own entries" on public.event_participants
  for select to authenticated using (user_id = auth.uid());

create policy "organizers see entries for their events" on public.event_participants
  for select to authenticated using (
    exists (select 1 from public.events e where e.id = event_id and e.organizer_id = auth.uid())
  );

revoke insert, update, delete on public.event_participants from anon, authenticated;

create policy "organizer and confirmed players read notes" on public.event_private_notes
  for select to authenticated using (
    exists (select 1 from public.events e where e.id = event_id and e.organizer_id = auth.uid())
    or exists (
      select 1 from public.event_participants p
      where p.event_id = event_private_notes.event_id and p.user_id = auth.uid() and p.status = 'confirmed'
    )
  );
create policy "organizer writes notes" on public.event_private_notes
  for insert to authenticated with check (
    exists (select 1 from public.events e where e.id = event_id and e.organizer_id = auth.uid())
  );
create policy "organizer updates notes" on public.event_private_notes
  for update to authenticated using (
    exists (select 1 from public.events e where e.id = event_id and e.organizer_id = auth.uid())
  );

revoke delete on public.event_private_notes from anon, authenticated;
revoke all on public.event_private_notes from anon;

-- ---------------------------------------------------------------------------
-- Chat
-- ---------------------------------------------------------------------------

create table public.conversations (
  id uuid primary key default gen_random_uuid(),
  kind public.conversation_kind not null,
  event_id uuid unique references public.events (id) on delete cascade,
  direct_key text unique,
  last_message_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  check ((kind = 'event') = (event_id is not null)),
  check ((kind = 'direct') = (direct_key is not null))
);

create table public.conversation_members (
  conversation_id uuid not null references public.conversations (id) on delete cascade,
  user_id uuid not null references public.player_profiles (id) on delete cascade,
  last_read_at timestamptz not null default now(),
  joined_at timestamptz not null default now(),
  primary key (conversation_id, user_id)
);

create index conversation_members_user_idx on public.conversation_members (user_id);

create table public.messages (
  id bigint generated always as identity primary key,
  conversation_id uuid not null references public.conversations (id) on delete cascade,
  sender_id uuid not null default auth.uid() references public.player_profiles (id) on delete cascade,
  body text not null check (char_length(btrim(body)) between 1 and 2000),
  created_at timestamptz not null default now()
);

create index messages_conversation_idx on public.messages (conversation_id, created_at desc);

create function public.is_conversation_member(conv uuid, uid uuid default auth.uid()) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.conversation_members m where m.conversation_id = conv and m.user_id = uid
  );
$$;

alter table public.conversations enable row level security;
alter table public.conversation_members enable row level security;
alter table public.messages enable row level security;

create policy "members see conversations" on public.conversations
  for select to authenticated using (public.is_conversation_member(id));

create policy "members see membership" on public.conversation_members
  for select to authenticated using (public.is_conversation_member(conversation_id));

create policy "members mark read" on public.conversation_members
  for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());

create policy "members read messages" on public.messages
  for select to authenticated using (public.is_conversation_member(conversation_id));

create policy "members send messages" on public.messages
  for insert to authenticated with check (sender_id = auth.uid() and public.is_conversation_member(conversation_id));

revoke all on public.conversations, public.conversation_members, public.messages from anon;
revoke insert, update, delete on public.conversations from authenticated;
revoke insert, update, delete on public.conversation_members from authenticated;
grant update (last_read_at) on public.conversation_members to authenticated;
revoke insert, update, delete on public.messages from authenticated;
grant insert (conversation_id, body) on public.messages to authenticated;

create function public.rallyz_touch_conversation() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  update public.conversations set last_message_at = new.created_at where id = new.conversation_id;
  update public.conversation_members set last_read_at = new.created_at
    where conversation_id = new.conversation_id and user_id = new.sender_id;
  return new;
end;
$$;

create trigger on_message_sent
  after insert on public.messages
  for each row execute function public.rallyz_touch_conversation();

-- ---------------------------------------------------------------------------
-- Notifications
-- ---------------------------------------------------------------------------

create table public.notifications (
  id bigint generated always as identity primary key,
  user_id uuid not null references public.player_profiles (id) on delete cascade,
  kind text not null,
  event_id uuid references public.events (id) on delete cascade,
  actor_id uuid references public.player_profiles (id) on delete set null,
  link text,
  body text not null,
  read_at timestamptz,
  created_at timestamptz not null default now()
);

create index notifications_user_idx on public.notifications (user_id, created_at desc);

alter table public.notifications enable row level security;

create policy "users read their notifications" on public.notifications
  for select to authenticated using (user_id = auth.uid());
create policy "users mark their notifications read" on public.notifications
  for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());

revoke all on public.notifications from anon;
revoke insert, update, delete on public.notifications from authenticated;
grant update (read_at) on public.notifications to authenticated;

-- ---------------------------------------------------------------------------
-- Instructors (freelance coaches) and lesson requests
-- ---------------------------------------------------------------------------

create table public.coach_profiles (
  user_id uuid primary key references public.player_profiles (id) on delete cascade,
  headline text not null check (char_length(headline) between 5 and 100),
  bio text not null default '' check (char_length(bio) <= 3000),
  rate_private_thb integer not null check (rate_private_thb between 0 and 100000),
  rate_group_thb integer check (rate_group_thb between 0 and 100000),
  areas text[] not null default '{}',
  venues text not null default '' check (char_length(venues) <= 300),
  level_min smallint not null default 1 check (level_min between 1 and 9),
  level_max smallint not null default 9 check (level_max between 1 and 9),
  languages text[] not null default '{}',
  years_coaching smallint check (years_coaching between 0 and 70),
  certifications text not null default '' check (char_length(certifications) <= 300),
  trial_offer text not null default '' check (char_length(trial_offer) <= 200),
  status public.coach_status not null default 'pending',
  review_note text,
  reviewed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (level_max >= level_min)
);

create index coach_profiles_status_idx on public.coach_profiles (status);

alter table public.coach_profiles enable row level security;

create policy "approved instructors are public" on public.coach_profiles
  for select using (status = 'approved' or user_id = auth.uid() or public.rallyz_is_admin());
create policy "users create their instructor profile" on public.coach_profiles
  for insert to authenticated with check (user_id = auth.uid());
create policy "users edit their instructor profile" on public.coach_profiles
  for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());

revoke insert, update, delete on public.coach_profiles from anon, authenticated;
grant insert (user_id, headline, bio, rate_private_thb, rate_group_thb, areas, venues, level_min, level_max,
              languages, years_coaching, certifications, trial_offer)
  on public.coach_profiles to authenticated;
grant update (headline, bio, rate_private_thb, rate_group_thb, areas, venues, level_min, level_max,
              languages, years_coaching, certifications, trial_offer)
  on public.coach_profiles to authenticated;

-- A rejected profile goes back into review when the coach edits it.
create function public.coach_profile_touch() returns trigger
language plpgsql set search_path = public as $$
begin
  new.updated_at := now();
  if old.status = 'rejected' and new.status = 'rejected' and not public.rallyz_is_admin() then
    new.status := 'pending';
    new.review_note := null;
  end if;
  return new;
end;
$$;

create trigger coach_profile_touch
  before update on public.coach_profiles
  for each row execute function public.coach_profile_touch();

create table public.lesson_requests (
  id uuid primary key default gen_random_uuid(),
  coach_id uuid not null references public.coach_profiles (user_id) on delete cascade,
  player_id uuid not null references public.player_profiles (id) on delete cascade,
  kind public.lesson_kind not null default 'private',
  players smallint not null default 1 check (players between 1 and 12),
  preferred_at timestamptz not null,
  note text not null default '' check (char_length(note) <= 1000),
  status public.lesson_request_status not null default 'pending',
  conversation_id uuid references public.conversations (id) on delete set null,
  created_at timestamptz not null default now(),
  responded_at timestamptz
);

create index lesson_requests_coach_idx on public.lesson_requests (coach_id, created_at desc);
create index lesson_requests_player_idx on public.lesson_requests (player_id, created_at desc);

alter table public.lesson_requests enable row level security;

create policy "players and coaches see their lesson requests" on public.lesson_requests
  for select to authenticated using (player_id = auth.uid() or coach_id = auth.uid());

revoke all on public.lesson_requests from anon;
revoke insert, update, delete on public.lesson_requests from authenticated;
