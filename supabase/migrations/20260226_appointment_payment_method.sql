-- Add payment_method to appointments so barber knows if client is paying online or at shop
ALTER TABLE appointments
  ADD COLUMN IF NOT EXISTS payment_method text NOT NULL DEFAULT 'at_shop'
  CHECK (payment_method IN ('apple_pay', 'card', 'at_shop'));
