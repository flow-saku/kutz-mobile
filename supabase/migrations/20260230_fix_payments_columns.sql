-- Ensure payments table has all required columns
-- Safe to run even if columns already exist (IF NOT EXISTS)

alter table payments
  add column if not exists payment_type        text not null default 'online',
  add column if not exists platform_fee_cents  integer,
  add column if not exists stripe_charge_id    text,
  add column if not exists updated_at          timestamptz not null default now();

-- Ensure appointments table has payment_id column linking to payments
alter table appointments
  add column if not exists payment_id uuid references payments(id) on delete set null;

-- Ensure RLS policies exist (drop first to avoid duplicate errors)
drop policy if exists "barber_payments_select"    on payments;
drop policy if exists "service_role_payments_all" on payments;
drop policy if exists "barber_payments_insert"    on payments;

-- Barber can see their own payments
create policy "barber_payments_select" on payments
  for select using (barber_id = auth.uid());

-- Service role can do everything (edge functions run as service role)
create policy "service_role_payments_all" on payments
  for all using (auth.role() = 'service_role');

-- Barber can insert payments directly (POS from mobile)
create policy "barber_payments_insert" on payments
  for insert with check (barber_id = auth.uid());

-- Indexes for fast lookups
create index if not exists payments_appointment_idx on payments(appointment_id);
create index if not exists payments_barber_idx      on payments(barber_id);
create index if not exists payments_pi_idx          on payments(stripe_payment_intent_id);
