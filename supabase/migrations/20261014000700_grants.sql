-- Rallyz: table permissions for the API roles.
--
-- Newer Supabase projects don't give anon/authenticated access to new tables
-- automatically. Row level security still decides WHICH rows each person sees;
-- these grants only open the door to the table. Column-limited writes were
-- granted in earlier migrations and are left as they are.
-- Safe to run again.

-- Public pages (logged-out visitors): events and approved instructors.
-- player_profiles for anon is column-limited (granted in the partner migration).
grant select on public.events, public.coach_profiles to anon;
grant select (id, display_name, avatar_url, level, is_founding_organizer) on public.player_profiles to anon;

-- Signed-in players: read access (RLS filters the rows).
grant select on
  public.player_profiles,
  public.organizer_settings,
  public.events,
  public.event_private_notes,
  public.event_participants,
  public.conversations,
  public.conversation_members,
  public.messages,
  public.notifications,
  public.coach_profiles,
  public.lesson_requests,
  public.play_requests,
  public.play_request_responses,
  public.user_blocks,
  public.user_reports
to authenticated;

-- Writes that go straight to a table (RLS policies check ownership).
grant insert, update on public.organizer_settings to authenticated;   -- own PromptPay ID
grant insert, update on public.event_private_notes to authenticated;  -- organizer's meeting note
grant insert, delete on public.user_blocks to authenticated;          -- block / unblock

-- Schemas used by policies.
grant usage on schema public to anon, authenticated;
grant usage on schema rallyz_private to anon, authenticated;

notify pgrst, 'reload schema';
