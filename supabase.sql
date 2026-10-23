-- Rode no Supabase: SQL Editor > New query > Run
create table if not exists public.app_data (
  key text primary key,
  value jsonb not null,
  updated_at timestamptz not null default now()
);

alter table public.app_data enable row level security;

drop policy if exists "funcionarios leem" on public.app_data;
drop policy if exists "funcionarios gravam" on public.app_data;
drop policy if exists "funcionarios atualizam" on public.app_data;
drop policy if exists "funcionarios apagam" on public.app_data;

create policy "funcionarios leem"      on public.app_data for select to authenticated using (true);
create policy "funcionarios gravam"    on public.app_data for insert to authenticated with check (true);
create policy "funcionarios atualizam" on public.app_data for update to authenticated using (true) with check (true);
create policy "funcionarios apagam"    on public.app_data for delete to authenticated using (true);
-- Visitantes sem login (anon) não têm nenhuma permissão.
