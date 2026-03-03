-- ─────────────────────────────────────────────────────────────
-- Stripe Connect: add stripe columns to profiles + payments table
-- ─────────────────────────────────────────────────────────────

-- 1. Add Stripe Connect account ID to barber profiles
alter table profiles
  add column if not exists stripe_account_id text,
  add column if not exists stripe_onboarding_complete boolean not null default false,
  add column if not exists stripe_charges_enabled boolean not null default false,
  add column if not exists stripe_payouts_enabled boolean not null default false;

-- 2. Payments table — records every charge (online or in-person POS)
create table if not exists payments (
  id                  uuid primary key default gen_random_uuid(),
  appointment_id      uuid references appointments(id) on delete set null,
  barber_id           uuid references profiles(id) on delete set null,
  client_id           uuid references profiles(id) on delete set null,
  amount_cents        integer not null,           -- amount in cents
  currency            text not null default 'usd',
  stripe_payment_intent_id text,
  stripe_charge_id    text,
  status              text not null default 'pending',  -- pending | succeeded | failed | refunded
  payment_type        text not null default 'online',   -- online | pos
  platform_fee_cents  integer,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);

-- RLS on payments
alter table payments enable row level security;

-- Barber can see their own payments
create policy "barber_payments_select" on payments
  for select using (barber_id = auth.uid());

-- Service role can insert/update (edge functions use service role)
create policy "service_role_payments_all" on payments
  for all using (auth.role() = 'service_role');

-- Barber can also insert payments directly (for POS from mobile)
create policy "barber_payments_insert" on payments
  for insert with check (barber_id = auth.uid());

-- 3. Add payment columns to appointments
alter table appointments
  add column if not exists paid boolean not null default false,
  add column if not exists payment_id uuid references payments(id) on delete set null;

-- 4. Index for fast lookups
create index if not exists payments_appointment_idx on payments(appointment_id);
create index if not exists payments_barber_idx on payments(barber_id);
create index if not exists payments_pi_idx on payments(stripe_payment_intent_id);
