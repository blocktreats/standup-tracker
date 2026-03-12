-- Run this in your Supabase SQL Editor (Dashboard > SQL Editor > New query)

-- 1. Create the meetings table
create table if not exists meetings (
  id text primary key,
  data jsonb not null default '{}',
  updated_at timestamptz default now()
);

-- 2. Enable Row Level Security with open access (no auth required)
alter table meetings enable row level security;

create policy "Allow anonymous read" on meetings
  for select using (true);

create policy "Allow anonymous insert" on meetings
  for insert with check (true);

create policy "Allow anonymous update" on meetings
  for update using (true) with check (true);

-- 3. Enable Realtime for this table
alter publication supabase_realtime add table meetings;
