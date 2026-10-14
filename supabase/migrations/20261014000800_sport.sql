-- Rallyz: every event, partner post and instructor belongs to a sport.
-- The site is split by sport in the address (/tennis/events, /tennis/partner,
-- /tennis/instructors). Only tennis is live; adding a sport later needs no
-- database change. Existing rows become tennis. Safe to run again.

-- Sport names are short lowercase slugs used in web addresses.
alter table public.events drop constraint if exists events_sport_slug;
alter table public.events add constraint events_sport_slug check (sport ~ '^[a-z]{3,20}$');
create index if not exists events_sport_upcoming_idx on public.events (sport, starts_at) where cancelled_at is null;

-- Partner posts
alter table public.play_requests
  add column if not exists sport text not null default 'tennis';
alter table public.play_requests drop constraint if exists play_requests_sport_slug;
alter table public.play_requests add constraint play_requests_sport_slug check (sport ~ '^[a-z]{3,20}$');
create index if not exists play_requests_sport_open_idx on public.play_requests (sport, starts_at) where status = 'open';
grant insert (sport) on public.play_requests to authenticated;

-- Instructors can teach more than one sport.
alter table public.coach_profiles
  add column if not exists sports text[] not null default '{tennis}';
alter table public.coach_profiles drop constraint if exists coach_profiles_sports_slugs;
alter table public.coach_profiles add constraint coach_profiles_sports_slugs
  check (cardinality(sports) between 1 and 5 and array_to_string(sports, ',') ~ '^[a-z]{3,20}(,[a-z]{3,20})*$');
create index if not exists coach_profiles_sports_idx on public.coach_profiles using gin (sports);
grant insert (sports), update (sports) on public.coach_profiles to authenticated;

notify pgrst, 'reload schema';
