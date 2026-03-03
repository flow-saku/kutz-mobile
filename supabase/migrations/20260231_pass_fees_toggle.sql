-- Add toggle for barbers to choose whether booking fees are passed to clients
alter table profiles
  add column if not exists pass_fees_to_client boolean not null default true;
