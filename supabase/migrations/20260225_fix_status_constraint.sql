-- Drop old status check constraint and recreate with in_chair + no_show
ALTER TABLE appointments DROP CONSTRAINT IF EXISTS appointments_status_check;

ALTER TABLE appointments
  ADD CONSTRAINT appointments_status_check
  CHECK (status IN ('pending', 'confirmed', 'in_chair', 'completed', 'cancelled', 'no_show'));
