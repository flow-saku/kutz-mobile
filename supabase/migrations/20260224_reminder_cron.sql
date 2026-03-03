-- Enable pg_cron extension (must be done in Supabase Dashboard → Extensions first)
-- This migration sets up a daily cron job to send 24h appointment reminders via edge function.

-- The cron job runs every hour and calls the send-reminder edge function in batch mode.
-- The function itself filters to appointments starting in 23-25 hours.
select
  cron.schedule(
    'send-24h-appointment-reminders',   -- job name (unique)
    '0 * * * *',                         -- every hour on the hour
    $$
    select
      net.http_post(
        url := current_setting('app.supabase_url') || '/functions/v1/send-reminder',
        headers := jsonb_build_object(
          'Content-Type', 'application/json',
          'Authorization', 'Bearer ' || current_setting('app.supabase_service_role_key')
        ),
        body := '{}'::jsonb
      );
    $$
  );
