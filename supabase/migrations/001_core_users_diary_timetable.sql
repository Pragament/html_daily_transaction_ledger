-- 001: shared identity, roles, diary tables, timetable (single-school model, one Supabase project)
-- Tables are the ones the three apps already define; the integration changes are in section C.
create extension if not exists pgcrypto;

-- ===== A. users + roles ==========================================================
create table if not exists public.users (
  id uuid primary key references auth.users(id),
  email text not null,
  name text default '',
  avatar_url text default '',
  role text default 'teacher',
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);
alter table public.users add column if not exists is_active boolean not null default true;
alter table public.users drop constraint if exists users_role_check;
alter table public.users add constraint users_role_check check (role in
  ('teacher','principal','vice_principal','hod','admin','super_admin','student','accountant'));
alter table public.users alter column role set default 'student';   -- least privilege

create or replace function public.get_my_role() returns text language sql stable security definer
set search_path = public, pg_temp as $$
  select role from public.users where id = auth.uid() and is_active $$;
create or replace function public.is_admin_role() returns boolean language sql stable security definer
set search_path = public, pg_temp as $$ select coalesce(public.get_my_role() in ('admin','super_admin'), false) $$;
-- principal-level managers: may manage teachers, timetable, approve diaries
create or replace function public.is_staff_manager() returns boolean language sql stable security definer
set search_path = public, pg_temp as $$ select coalesce(public.get_my_role() in ('admin','super_admin','principal','vice_principal'), false) $$;
create or replace function public.can_read_all_staff() returns boolean language sql stable security definer
set search_path = public, pg_temp as $$ select coalesce(public.get_my_role() in ('admin','super_admin','principal','vice_principal','hod'), false) $$;

-- Profile created server-side on Auth user creation. Role comes ONLY from app_metadata
-- (settable by service role / admin API, never by a browser signUp).
create or replace function public.handle_new_user() returns trigger language plpgsql security definer
set search_path = public, pg_temp as $$
declare r text := coalesce(new.raw_app_meta_data->>'role','student');
begin
  if r not in ('teacher','principal','vice_principal','hod','admin','super_admin','student','accountant') then r := 'student'; end if;
  insert into public.users(id,email,name,role)
  values (new.id,new.email,coalesce(new.raw_user_meta_data->>'full_name',''),r) on conflict (id) do nothing;
  return new;
end $$;
drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users for each row execute function public.handle_new_user();

-- Block role escalation / self-reactivation by browser callers (auth.uid() is null for service role & migrations)
create or replace function public.guard_user_changes() returns trigger language plpgsql security definer
set search_path = public, pg_temp as $$
begin
  if auth.uid() is null then return new; end if;
  if tg_op = 'INSERT' then raise exception 'Profiles are created by the server only'; end if;
  new.id := old.id;
  if new.role is distinct from old.role and not public.is_admin_role() then
    raise exception 'Only an admin can change roles'; end if;
  if new.email is distinct from old.email and not public.is_admin_role() then new.email := old.email; end if;
  if new.is_active is distinct from old.is_active then
    if old.id = auth.uid() then raise exception 'You cannot change your own active status'; end if;
    if not (public.is_admin_role() or (public.get_my_role() in ('principal','vice_principal') and old.role in ('teacher','student','accountant'))) then
      raise exception 'Not allowed to change active status'; end if;
  end if;
  new.updated_at := now();
  return new;
end $$;
drop trigger if exists trg_guard_user_changes on public.users;
create trigger trg_guard_user_changes before insert or update on public.users for each row execute function public.guard_user_changes();

alter table public.users enable row level security;
drop policy if exists users_select on public.users;
create policy users_select on public.users for select to authenticated
  using (id = auth.uid() or public.can_read_all_staff());
drop policy if exists users_update on public.users;
create policy users_update on public.users for update to authenticated
  using (id = auth.uid() or public.is_admin_role() or (public.get_my_role() in ('principal','vice_principal') and role in ('teacher','student','accountant')))
  with check (id = auth.uid() or public.is_admin_role() or (public.get_my_role() in ('principal','vice_principal') and role in ('teacher','student','accountant')));
-- no INSERT / DELETE policies: profiles come from the trigger; deactivate instead of delete.

-- ===== B. Teacher Diary tables ===================================================
create table if not exists public.timetable (
  id uuid default gen_random_uuid() primary key,
  teacher_id uuid references public.users(id) on delete cascade,
  day_of_week int not null check (day_of_week between 1 and 7),
  period_number int not null,
  class_section text not null,
  subject text not null,
  start_time time, end_time time,
  unique (teacher_id, day_of_week, period_number)
);
create table if not exists public.daily_entries (
  id uuid default gen_random_uuid() primary key,
  teacher_id uuid references public.users(id) on delete cascade,
  date date not null,
  period_number int not null,
  class_section text default '',
  subject text default '',
  classwork text default '',
  homework text default '',
  status text default 'draft' check (status in ('draft','submitted','approved','revision_requested')),
  revision_number int default 1,
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  revision_note text default null,
  submitted_at timestamptz default null,
  approved_at timestamptz default null,
  unique (teacher_id, date, period_number, revision_number)
);
create table if not exists public.attachments (
  id uuid default gen_random_uuid() primary key,
  entry_id uuid references public.daily_entries(id) on delete cascade,
  teacher_id uuid references public.users(id),
  file_name text not null, file_url text not null, file_type text, file_size int,
  created_at timestamptz default now()
);
create table if not exists public.principal_signatures (
  id uuid default gen_random_uuid() primary key,
  entry_id uuid references public.daily_entries(id) on delete cascade,
  signed_by uuid references public.users(id),
  signature_hash text not null, remarks text, signed_at timestamptz default now()
);
create table if not exists public.audit_logs (
  id bigserial primary key,
  user_id uuid references public.users(id), role text, action text not null, table_name text,
  record_id text, before_value jsonb, after_value jsonb, ip_address text, user_agent text,
  created_at timestamptz default now(), change_summary text
);
create table if not exists public.notifications (
  id uuid default gen_random_uuid() primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  type text not null, title text not null, message text not null,
  is_read boolean default false, related_date date, related_entry_ids text[],
  created_at timestamptz default now()
);
create table if not exists public.boards (id serial primary key, name text not null, is_active boolean default true, display_order int default 0);
create table if not exists public.classes (id serial primary key, name text not null, is_active boolean default true, display_order int default 0);
create table if not exists public.subjects (id serial primary key, name text not null, icon text, folder_key text, is_active boolean default true, display_order int default 0);
create table if not exists public.slow_learner_entries (
  id uuid default gen_random_uuid() primary key,
  teacher_id uuid references public.users(id) on delete cascade, date date not null,
  class_name text default '', section text default '', student_id text default '', student_name text not null,
  subject text default '', learning_gap text default '', strategy text default '', progress text default '', next_step text default '',
  created_at timestamptz default now(), updated_at timestamptz default now()
);
create index if not exists idx_sle_teacher_date on public.slow_learner_entries(teacher_id,date);
create index if not exists idx_daily_entries_date on public.daily_entries(date, teacher_id);

create or replace function public.set_updated_at() returns trigger language plpgsql set search_path = public as $$
begin new.updated_at = now(); return new; end $$;
drop trigger if exists update_slow_learner_entries_updated_at on public.slow_learner_entries;
create trigger update_slow_learner_entries_updated_at before update on public.slow_learner_entries for each row execute function public.set_updated_at();

insert into public.boards(name,display_order) select v.n,v.o from (values ('CBSE',1),('ICSE',2),('State Board',3)) v(n,o) where not exists (select 1 from public.boards);
insert into public.classes(name,display_order) select g::text,g from generate_series(1,10) g where not exists (select 1 from public.classes);
insert into public.subjects(name,display_order) select v.n,v.o from (values ('Mathematics',1),('Science',2),('Social Studies',3),('English',4),('Hindi',5),('Telugu',6)) v(n,o) where not exists (select 1 from public.subjects);

-- Diary guard: teachers cannot approve / request revision / forge approval fields; nobody approves own entry
create or replace function public.guard_daily_entry() returns trigger language plpgsql security definer
set search_path = public, pg_temp as $$
begin
  if auth.uid() is null then return new; end if;
  if tg_op = 'INSERT' then
    if new.teacher_id <> auth.uid() then raise exception 'Cannot create entries for another teacher'; end if;
    if new.status not in ('draft','submitted') then raise exception 'New entries must be draft or submitted'; end if;
    new.approved_at := null; new.revision_note := null;
    if new.status = 'submitted' and new.submitted_at is null then new.submitted_at := now(); end if;
    return new;
  end if;
  new.teacher_id := old.teacher_id;
  new.updated_at := now();
  if new.status is distinct from old.status and new.status in ('approved','revision_requested') then
    if not coalesce(public.get_my_role() in ('principal','vice_principal','admin','super_admin'), false) then raise exception 'Only a principal/admin can approve or request revisions'; end if;
    if old.teacher_id = auth.uid() then raise exception 'You cannot approve or review your own entry'; end if;
  end if;
  if not (public.get_my_role() in ('principal','vice_principal','admin','super_admin')) then
    new.approved_at := old.approved_at; new.revision_note := old.revision_note;
  end if;
  if new.status = 'submitted' and old.status is distinct from 'submitted' then new.submitted_at := now(); end if;
  if new.status = 'approved' and old.status is distinct from 'approved' then new.approved_at := now(); end if;
  return new;
end $$;
drop trigger if exists trg_guard_daily_entry on public.daily_entries;
create trigger trg_guard_daily_entry before insert or update on public.daily_entries for each row execute function public.guard_daily_entry();

-- RLS
alter table public.daily_entries enable row level security;
drop policy if exists de_select on public.daily_entries; drop policy if exists de_insert on public.daily_entries;
drop policy if exists de_update on public.daily_entries; drop policy if exists de_delete on public.daily_entries;
create policy de_select on public.daily_entries for select to authenticated using (teacher_id = auth.uid() or public.can_read_all_staff());
create policy de_insert on public.daily_entries for insert to authenticated
  with check (teacher_id = auth.uid() and public.get_my_role() in ('teacher','hod','principal','vice_principal','admin','super_admin'));
create policy de_update on public.daily_entries for update to authenticated
  using ((teacher_id = auth.uid() and status <> 'approved') or public.get_my_role() in ('principal','vice_principal','admin','super_admin'))
  with check ((teacher_id = auth.uid()) or public.get_my_role() in ('principal','vice_principal','admin','super_admin'));
create policy de_delete on public.daily_entries for delete to authenticated
  using ((teacher_id = auth.uid() and status <> 'approved') or public.get_my_role() in ('principal','vice_principal','admin','super_admin'));

alter table public.attachments enable row level security;
drop policy if exists att_select on public.attachments; drop policy if exists att_insert on public.attachments; drop policy if exists att_delete on public.attachments;
create policy att_select on public.attachments for select to authenticated using (teacher_id = auth.uid() or public.can_read_all_staff());
create policy att_insert on public.attachments for insert to authenticated with check (teacher_id = auth.uid());
create policy att_delete on public.attachments for delete to authenticated using (teacher_id = auth.uid());

alter table public.principal_signatures enable row level security;
drop policy if exists sig_select on public.principal_signatures; drop policy if exists sig_write on public.principal_signatures;
create policy sig_select on public.principal_signatures for select to authenticated
  using (public.is_staff_manager() or exists (select 1 from public.daily_entries e where e.id = entry_id and e.teacher_id = auth.uid()));
create policy sig_write on public.principal_signatures for all to authenticated
  using (public.is_staff_manager()) with check (public.is_staff_manager() and signed_by = auth.uid());

alter table public.audit_logs enable row level security;
drop policy if exists audit_select on public.audit_logs; drop policy if exists audit_insert on public.audit_logs;
create policy audit_select on public.audit_logs for select to authenticated using (user_id = auth.uid() or public.is_staff_manager());
create policy audit_insert on public.audit_logs for insert to authenticated with check (user_id = auth.uid());

alter table public.notifications enable row level security;
drop policy if exists notif_select on public.notifications; drop policy if exists notif_update on public.notifications; drop policy if exists notif_insert on public.notifications;
create policy notif_select on public.notifications for select to authenticated using (user_id = auth.uid());
create policy notif_update on public.notifications for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy notif_insert on public.notifications for insert to authenticated with check (public.is_staff_manager());  -- teachers use notify_principals()

create or replace function public.notify_principals(p_type text, p_title text, p_message text, p_related_date date, p_related_entry_ids text[])
returns void language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if auth.uid() is null or public.get_my_role() is null then raise exception 'Not authenticated'; end if;
  insert into public.notifications(user_id,type,title,message,related_date,related_entry_ids)
  select u.id,p_type,left(p_title,200),left(p_message,1000),p_related_date,p_related_entry_ids
  from public.users u where u.is_active and u.role in ('principal','vice_principal','admin','super_admin');
end $$;
revoke all on function public.notify_principals(text,text,text,date,text[]) from public, anon;
grant execute on function public.notify_principals(text,text,text,date,text[]) to authenticated;

alter table public.boards enable row level security; alter table public.classes enable row level security; alter table public.subjects enable row level security;
do $$ declare t text; begin
  foreach t in array array['boards','classes','subjects'] loop
    execute format('drop policy if exists %I on public.%I', t||'_read', t);
    execute format('drop policy if exists %I on public.%I', t||'_write', t);
    execute format('create policy %I on public.%I for select to authenticated using (true)', t||'_read', t);
    execute format('create policy %I on public.%I for all to authenticated using (public.is_staff_manager()) with check (public.is_staff_manager())', t||'_write', t);
  end loop; end $$;

alter table public.slow_learner_entries enable row level security;
drop policy if exists sle_select on public.slow_learner_entries; drop policy if exists sle_write on public.slow_learner_entries;
create policy sle_select on public.slow_learner_entries for select to authenticated using (teacher_id = auth.uid() or public.can_read_all_staff());
create policy sle_write on public.slow_learner_entries for all to authenticated using (teacher_id = auth.uid()) with check (teacher_id = auth.uid());

-- ===== C. Integration changes to existing `timetable` (no new table) =============
-- The editor's model (class x day x period, combined classes, master vs working, plus settings/breaks/
-- substitutions/overrides) does not fit (teacher,day,period) uniqueness, so:
--  * drop that unique (a teacher may legitimately be in 2 classes in one period for combined classes)
--  * add status (working|master), teacher_code (editor id = faculty.employee_id), subject_code, combined_group
--  * unique real invariant: one cell per (status,class,day,period)
--  * one 'config' row (row_kind='config', status 'working') holds editor-only JSON that has no relational home
alter table public.timetable drop constraint if exists timetable_teacher_id_day_of_week_period_number_key;
alter table public.timetable add column if not exists row_kind text not null default 'period' check (row_kind in ('period','config'));
alter table public.timetable add column if not exists status text not null default 'master' check (status in ('working','master'));
alter table public.timetable add column if not exists teacher_code text;
alter table public.timetable add column if not exists subject_code text;
alter table public.timetable add column if not exists combined_group text;
alter table public.timetable add column if not exists payload jsonb;
alter table public.timetable add column if not exists version bigint not null default 1;
alter table public.timetable add column if not exists updated_by uuid references public.users(id);
alter table public.timetable add column if not exists updated_at timestamptz default now();
alter table public.timetable alter column day_of_week drop not null;
alter table public.timetable alter column period_number drop not null;
alter table public.timetable alter column class_section drop not null;
alter table public.timetable alter column subject drop not null;
alter table public.timetable drop constraint if exists timetable_period_fields;
alter table public.timetable add constraint timetable_period_fields check
  (row_kind = 'config' or (day_of_week between 1 and 7 and period_number is not null and class_section is not null and subject is not null));
create unique index if not exists timetable_cell_uq on public.timetable(status, class_section, day_of_week, period_number) where row_kind = 'period';
create unique index if not exists timetable_config_uq on public.timetable(status) where row_kind = 'config';
create index if not exists timetable_teacher_day_idx on public.timetable(teacher_id, day_of_week, period_number) where row_kind = 'period' and status = 'master';
create index if not exists timetable_teacher_code_idx on public.timetable(teacher_code);

alter table public.timetable enable row level security;
drop policy if exists tt_select on public.timetable; drop policy if exists tt_write on public.timetable;
create policy tt_select on public.timetable for select to authenticated using (
  public.is_staff_manager() or public.get_my_role() = 'hod'
  or (row_kind = 'period' and status = 'master' and teacher_id = auth.uid()));
create policy tt_write on public.timetable for all to authenticated using (public.is_staff_manager()) with check (public.is_staff_manager());
