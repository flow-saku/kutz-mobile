-- Add is_walk_in flag to appointments to distinguish walk-ins from booked clients
alter table appointments
  add column if not exists is_walk_in boolean not null default false;
