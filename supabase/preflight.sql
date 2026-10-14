-- Rallyz preflight check. READ-ONLY: it changes nothing.
-- Run this in the Supabase SQL Editor before the migrations. It lists any
-- existing objects whose names Rallyz would create. If it returns no rows,
-- the migrations are safe to run. If it returns rows, send them over and the
-- migrations will be adapted.

with wanted(kind, name) as (
  values
    ('table', 'player_profiles'), ('table', 'app_admins'), ('table', 'organizer_settings'), ('table', 'events'),
    ('table', 'event_private_notes'), ('table', 'event_participants'), ('table', 'conversations'),
    ('table', 'conversation_members'), ('table', 'messages'), ('table', 'notifications'),
    ('table', 'coach_profiles'), ('table', 'lesson_requests'),
    ('type', 'event_type'), ('type', 'play_format'), ('type', 'entry_mode'),
    ('type', 'participant_status'), ('type', 'payment_status'), ('type', 'coach_status'),
    ('type', 'lesson_kind'), ('type', 'lesson_request_status'), ('type', 'conversation_kind'),
    ('function', 'rallyz_handle_new_user'), ('function', 'rallyz_is_admin'),
    ('function', 'is_conversation_member'), ('function', 'rallyz_touch_conversation'),
    ('function', 'coach_profile_touch'), ('function', '_notify'), ('function', '_display_name'),
    ('function', '_recount'), ('function', '_sync_event_chat'), ('function', '_promote_waitlist'),
    ('function', 'rallyz_handle_new_event'), ('function', 'rallyz_handle_event_updated'),
    ('function', 'join_event'), ('function', 'leave_event'), ('function', 'decide_participant'),
    ('function', 'cancel_event'), ('function', 'get_roster'), ('function', 'set_payment_status'),
    ('function', 'get_payment_info'), ('function', 'get_or_create_direct'),
    ('function', 'my_conversations'), ('function', 'review_coach'), ('function', 'request_lesson'),
    ('function', 'respond_lesson_request'), ('function', 'cancel_lesson_request'),
    ('function', 'admin_set_founding_organizer'), ('function', 'send_event_reminders'),
    ('function', 'admin_weekly_metrics'), ('function', 'rallyz_ensure_profile'),
    ('table', 'play_requests'), ('table', 'play_request_responses'), ('table', 'user_blocks'), ('table', 'user_reports'),
    ('type', 'play_request_status'), ('type', 'play_ask_status'), ('type', 'report_status'),
    ('function', 'ask_to_play'), ('function', 'answer_play_ask'), ('function', 'withdraw_play_ask'),
    ('function', 'cancel_play_request'), ('function', 'get_play_roster'), ('function', 'report_player'), ('function', 'resolve_report')
)
select w.kind, 'public.' || w.name as already_exists
from wanted w
where (w.kind = 'table' and exists (select 1 from pg_tables t where t.schemaname = 'public' and t.tablename = w.name))
   or (w.kind = 'type' and exists (select 1 from pg_type t join pg_namespace n on n.oid = t.typnamespace where n.nspname = 'public' and t.typname = w.name))
   or (w.kind = 'function' and exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname = w.name))
union all
select 'trigger on auth.users', tgname
from pg_trigger
where tgrelid = 'auth.users'::regclass and not tgisinternal and tgname = 'rallyz_on_auth_user_created'
order by 1, 2;
