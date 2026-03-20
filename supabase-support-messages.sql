-- Run this in your Supabase SQL Editor
-- Creates a simple inbox for support form submissions

create table if not exists support_messages (
  id bigint generated always as identity primary key,
  name text not null,
  email text not null,
  type text default 'other',
  message text not null,
  created_at timestamptz default now()
);

-- Lock down with RLS — only service role can insert/read
alter table support_messages enable row level security;
-- No policies = no anon access. Backend uses service_role key.
