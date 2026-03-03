-- ─────────────────────────────────────────────────────────────
-- Onboarding: birthday on clients, onboarding flags on profiles
-- ─────────────────────────────────────────────────────────────

-- 1. Add birthday to clients table (for birthday offers)
alter table clients
  add column if not exists birthday date,
  add column if not exists phone text;

-- 2. Add onboarding-complete flag to profiles (barbers)
alter table profiles
  add column if not exists onboarding_complete boolean not null default false,
  add column if not exists shop_bio text,
  add column if not exists phone text;

-- 3. Index for birthday queries (for automated birthday offers)
create index if not exists clients_birthday_month_day_idx
  on clients (extract(month from birthday), extract(day from birthday));
