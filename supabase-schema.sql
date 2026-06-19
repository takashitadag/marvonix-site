-- Marvonix administrace obsahu
-- Vložte do Supabase SQL Editoru a spusťte jednou.
create extension if not exists pgcrypto;

create table if not exists public.marvonix_content (
  id uuid primary key default gen_random_uuid(),
  type text not null check (type in ('team', 'references', 'audit_references')),
  title text not null,
  subtitle text,
  role text,
  body text not null,
  tag text,
  score int,
  image_url text,
  external_url text,
  visible boolean not null default true,
  sort_order int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists marvonix_content_type_visible_idx
  on public.marvonix_content (type, visible, sort_order, created_at desc);

alter table public.marvonix_content enable row level security;

-- Veřejný web čte jen viditelné záznamy přes serverovou API route.
-- Přímý přístup z browseru nepoužíváme, proto nejsou potřeba veřejné RLS policy.
