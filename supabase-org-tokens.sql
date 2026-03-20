-- Run this in your Supabase SQL Editor (Dashboard > SQL Editor > New query)
-- Adds the org_tokens table for multi-org OAuth support

-- 1. Create the org_tokens table
create table if not exists org_tokens (
  domain text primary key,             -- e.g. "acme.com"
  email text not null,                 -- the user who authorized, e.g. "admin@acme.com"
  refresh_token text not null,         -- Google OAuth refresh token
  access_token text,                   -- cached access token (refreshed automatically)
  token_expires_at timestamptz,        -- when the access token expires
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

-- 2. Enable RLS — block ALL anonymous access (tokens are sensitive)
alter table org_tokens enable row level security;

-- No policies = no access via anon key.
-- The backend uses the service_role key which bypasses RLS.

-- 3. Add an index on domain for fast lookups
create index if not exists idx_org_tokens_domain on org_tokens (domain);
