-- Add actual session timing columns for duration tracking & analytics
ALTER TABLE appointments
  ADD COLUMN IF NOT EXISTS started_at   timestamptz,
  ADD COLUMN IF NOT EXISTS completed_at timestamptz,
  ADD COLUMN IF NOT EXISTS actual_duration_minutes integer;

-- Analytics view: average actual duration per service
CREATE OR REPLACE VIEW service_duration_stats AS
SELECT
  a.service_id,
  s.name            AS service_name,
  s.barber_id,
  s.duration_minutes AS estimated_duration,
  COUNT(a.id)        AS session_count,
  ROUND(AVG(a.actual_duration_minutes)) AS avg_actual_duration,
  MIN(a.actual_duration_minutes)        AS min_duration,
  MAX(a.actual_duration_minutes)        AS max_duration
FROM appointments a
JOIN services s ON s.id = a.service_id
WHERE a.status = 'completed'
  AND a.actual_duration_minutes IS NOT NULL
GROUP BY a.service_id, s.name, s.barber_id, s.duration_minutes;
