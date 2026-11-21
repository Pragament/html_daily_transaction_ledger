-- 003: security hardening found by the Supabase advisor (no tables created or dropped).
-- Helper/RPC functions are callable by signed-in users only (RLS policies need authenticated EXECUTE); anon gets none.
do $$
declare f text;
begin
  foreach f in array array[
    'can_read_all_staff()','get_my_role()','has_ledger_access()','is_admin_role()','is_ledger_accountant()','is_ledger_admin()',
    'is_ledger_principal()','is_ledger_reader()','is_staff_manager()','get_my_periods(date)',
    'notify_principals(text,text,text,date,text[])',
    'pay_faculty_salary(uuid,uuid,date,text,numeric,text,text,text,text,text)','set_faculty_active(uuid,boolean)']
  loop
    execute format('revoke all on function public.%s from public, anon', f);
    execute format('grant execute on function public.%s to authenticated', f);
  end loop;
  -- trigger-only functions: nobody needs to call them over the API (triggers still fire)
  foreach f in array array['guard_daily_entry()','guard_user_changes()','handle_new_user()','link_timetable_teacher()',
    'set_faculty_context()','set_fep_context()','set_ledger_context()']
  loop
    execute format('revoke all on function public.%s from public, anon, authenticated', f);
  end loop;
end $$;
alter function public.protect_ledger_activity_history() set search_path = public, pg_temp;
alter function public.student_class_key(text, text) set search_path = public, pg_temp;
