-- Rallyz: player profiles are public only for people who take part in Rallyz.
-- Run after the five migrations (it needs the partner tables). Safe to run again.
--
-- The core migration gives every account a player profile, including venue owners,
-- staff, booking-app customers and coaches who never used events or find-a-partner.
-- This keeps those private. A profile shows to others once the person:
--   * finished player setup (onboarded), or
--   * is an approved instructor, or
--   * organized an event, joined / asked to join one, posted or asked on find-a-partner, or
--   * shares a chat with the person looking.
-- Everyone always sees their own profile; Rallyz admins see all.

begin;

create schema if not exists rallyz_private;

create or replace function rallyz_private.profile_visible(p uuid) returns boolean
  language sql stable security definer set search_path = public as $$
  select p = auth.uid()
      or exists (select 1 from public.player_profiles x where x.id = p and x.onboarded)
      or exists (select 1 from public.coach_profiles c where c.user_id = p and c.status = 'approved')
      or exists (select 1 from public.events e where e.organizer_id = p)
      or exists (select 1 from public.event_participants ep where ep.user_id = p and ep.status in ('confirmed', 'waitlisted', 'pending'))
      or exists (select 1 from public.play_requests r where r.author_id = p)
      or exists (select 1 from public.play_request_responses rr where rr.user_id = p)
      or (auth.uid() is not null and exists (
            select 1 from public.conversation_members a
            join public.conversation_members b on b.conversation_id = a.conversation_id
            where a.user_id = auth.uid() and b.user_id = p))
      or public.rallyz_is_admin()
$$;

revoke execute on function rallyz_private.profile_visible(uuid) from public;
grant usage on schema rallyz_private to anon, authenticated;
grant execute on function rallyz_private.profile_visible(uuid) to anon, authenticated;

drop policy if exists "player profiles are public" on public.player_profiles;
drop policy if exists "player profiles are public once they play" on public.player_profiles;
create policy "player profiles are public once they play" on public.player_profiles
  for select using (rallyz_private.profile_visible(id));

commit;

notify pgrst, 'reload schema';
