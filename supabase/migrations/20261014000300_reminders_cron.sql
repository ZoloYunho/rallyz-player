-- Hourly event reminders. Needs the pg_cron extension, which Supabase
-- provides (Database > Extensions). If you skip this migration, call
-- public.send_event_reminders() from any scheduler instead.
create extension if not exists pg_cron;

select cron.schedule(
  'rallyz-event-reminders',
  '5 * * * *',
  $$select public.send_event_reminders()$$
);
