-- Ledger is for admin / principal only (accountant no longer has access). Enforced in RLS via these helpers.
create or replace function public.has_ledger_access() returns boolean
language sql stable security definer set search_path to 'public','pg_temp'
as $$ select coalesce(public.get_my_role() in ('principal','admin','super_admin'), false) $$;
