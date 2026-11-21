-- 002: Ledger tables (existing definitions, single-school: no schools/school_id/app_access), faculty & students linked to
-- Auth users, timetable RPCs, storage, realtime.
-- ===== Ledger access derived from users.role (replaces app_access) =================
create or replace function public.has_ledger_access() returns boolean language sql stable security definer set search_path = public, pg_temp
as $$ select coalesce(public.get_my_role() in ('accountant','principal','admin','super_admin'), false) $$;
create or replace function public.is_ledger_admin() returns boolean language sql stable security definer set search_path = public, pg_temp
as $$ select public.is_admin_role() $$;
create or replace function public.is_ledger_principal() returns boolean language sql stable security definer set search_path = public, pg_temp
as $$ select coalesce(public.get_my_role() in ('principal','admin','super_admin'), false) $$;
create or replace function public.is_ledger_accountant() returns boolean language sql stable security definer set search_path = public, pg_temp
as $$ select public.has_ledger_access() $$;   -- accountant, principal, admin may write (same as original helper)
create or replace function public.is_ledger_reader() returns boolean language sql stable security definer set search_path = public, pg_temp
as $$ select public.has_ledger_access() $$;

-- ===== Ledger tables =============================================================
create table if not exists public.categories (id serial primary key, name text not null, parent_id integer references public.categories(id) on delete restrict,
  type text check (type in ('income','expense','all')), frequency text default 'Yearly' check (frequency in ('Monthly','Yearly','One-Time')),
  created_at timestamptz default now(), unique (name, parent_id));
create table if not exists public.tags (id serial primary key, name text unique not null, created_at timestamptz default now());
create table if not exists public.students (admission_number text primary key, name text not null, roll_number text, class text, section text,
  father_name text, phone text, created_at timestamptz default now(), updated_at timestamptz default now());
create sequence if not exists public.transactions_id_seq;
create table if not exists public.transactions (
  id integer primary key default nextval('public.transactions_id_seq'),
  type text not null check (type in ('income','expense')), date date not null, reference text, particulars text,
  amount numeric not null, head text, main_category text, sub_category text, tags text[] default '{}',
  created_by text, created_at timestamptz default now(), updated_by text, updated_at timestamptz default now(),
  deleted_by text, is_deleted boolean default false, bank_amount numeric default 0, cheque_count integer default 0,
  attachments jsonb default '[]'::jsonb);
alter sequence public.transactions_id_seq owned by public.transactions.id;
create table if not exists public.transaction_revisions (id uuid primary key default gen_random_uuid(),
  transaction_id integer not null references public.transactions(id) on delete restrict,
  action text not null check (action in ('CREATE','UPDATE','DELETE','RESTORE')), old_values jsonb, new_values jsonb,
  created_by text, created_at timestamptz default now());
create table if not exists public.activity_history (id uuid primary key, timestamp timestamptz default now(), date date not null, time text not null,
  user_name text, user_email text, firebase_uid text, activity_type text not null, transaction_id integer, description text,
  device_status text not null, sync_status text default 'synced');
create table if not exists public.user_profiles (email text primary key, full_name text not null, profession text not null,
  firebase_uid text, created_at timestamptz default now(), updated_at timestamptz default now());
create table if not exists public.fee_structures (id serial primary key, academic_year text not null, class text not null, fee_type text not null,
  amount numeric not null, frequency text not null check (frequency in ('Monthly','Yearly','One-Time')),
  created_at timestamptz default now(), updated_at timestamptz default now(), unique (academic_year, class, fee_type));
create table if not exists public.fee_payments (transaction_id integer primary key references public.transactions(id) on delete cascade,
  student_admission_number text not null references public.students(admission_number) on delete cascade,
  academic_year text not null, fee_month text not null, fee_type text not null,
  created_at timestamptz default now(), updated_at timestamptz default now());
create table if not exists public.student_fee_assignments (id serial primary key,
  student_id text not null references public.students(admission_number) on delete cascade, academic_year text not null,
  fee_category_id integer not null references public.categories(id) on delete cascade, assigned_amount numeric not null,
  remarks text default '', created_at timestamptz default now(), updated_at timestamptz default now(),
  unique (student_id, academic_year, fee_category_id));
create table if not exists public.faculty (id uuid primary key default gen_random_uuid(), employee_id text not null, faculty_name text not null,
  department text not null, designation text not null, mobile_number text not null, email text, joining_date date not null,
  salary numeric(14,2) not null default 0 check (salary >= 0), status text not null default 'active' check (status in ('active','inactive')),
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  created_by uuid references public.users(id), updated_by uuid references public.users(id),
  constraint faculty_employee_id_not_blank check (btrim(employee_id) <> ''), constraint faculty_name_not_blank check (btrim(faculty_name) <> ''));
create table if not exists public.faculty_expense_categories (id uuid primary key default gen_random_uuid(),
  parent_id uuid references public.faculty_expense_categories(id) on delete restrict, name text not null, is_active boolean not null default true,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  constraint faculty_expense_category_name_not_blank check (btrim(name) <> ''));
create table if not exists public.faculty_expense_payments (id uuid primary key default gen_random_uuid(),
  faculty_id uuid not null references public.faculty(id) on delete restrict,
  expense_category_id uuid not null references public.faculty_expense_categories(id) on delete restrict,
  transaction_id integer references public.transactions(id) on delete restrict,
  payment_date date not null default current_date, voucher_number text not null, amount numeric(14,2) not null check (amount > 0),
  payment_mode text not null check (payment_mode in ('cash','bank_transfer','cheque','upi','other')), remarks text,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  created_by uuid not null references public.users(id), updated_by uuid references public.users(id));

-- Integration changes to existing tables: link records to Auth identities
alter table public.faculty  add column if not exists user_id uuid unique references public.users(id);
alter table public.students add column if not exists user_id uuid unique references public.users(id);
alter table public.students add column if not exists email text;
alter table public.students add column if not exists is_active boolean not null default true;
alter table public.transactions add column if not exists user_id uuid references public.users(id);
alter table public.transaction_revisions add column if not exists user_id uuid references public.users(id);
alter table public.activity_history add column if not exists user_id uuid references public.users(id);
create unique index if not exists faculty_employee_id_uq on public.faculty(employee_id);
create unique index if not exists fep_voucher_uq on public.faculty_expense_payments(voucher_number);
create unique index if not exists fec_name_uq on public.faculty_expense_categories(coalesce(parent_id,'00000000-0000-0000-0000-000000000000'::uuid), lower(name));
create index if not exists idx_tx_deleted on public.transactions(is_deleted);
create index if not exists idx_tx_main on public.transactions(main_category);
create index if not exists idx_rev_tx on public.transaction_revisions(transaction_id);
create index if not exists idx_students_search on public.students(name, admission_number, roll_number);
create index if not exists idx_activity_ts on public.activity_history(timestamp);
create index if not exists idx_fp_student on public.fee_payments(student_admission_number, academic_year);
create index if not exists idx_sfa_student on public.student_fee_assignments(student_id, academic_year);
create index if not exists idx_fep_faculty on public.faculty_expense_payments(faculty_id, payment_date desc);
create index if not exists idx_faculty_status on public.faculty(status);

insert into public.faculty_expense_categories(name) select 'Faculty Expenses' where not exists (select 1 from public.faculty_expense_categories where parent_id is null and lower(name)='faculty expenses');
insert into public.faculty_expense_categories(parent_id,name)
 select (select id from public.faculty_expense_categories where parent_id is null and lower(name)='faculty expenses'), n
 from unnest(array['Salary','Advance Salary','Bonus','Incentives','Reimbursements','Other Faculty Expenses']) n
 where not exists (select 1 from public.faculty_expense_categories c where lower(c.name)=lower(n) and c.parent_id is not null);

-- ===== Triggers ==================================================================
create or replace function public.set_ledger_context() returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if auth.uid() is null then return new; end if;
  if not public.has_ledger_access() then raise exception 'Ledger access denied'; end if;
  if tg_op = 'INSERT' then new.user_id := auth.uid(); else new.user_id := old.user_id; end if;
  return new;
end $$;
do $$ declare t text; begin
  foreach t in array array['transactions','transaction_revisions','activity_history'] loop
    execute format('drop trigger if exists trg_ledger_ctx on public.%I', t);
    execute format('create trigger trg_ledger_ctx before insert or update on public.%I for each row execute function public.set_ledger_context()', t);
  end loop; end $$;
create or replace function public.protect_ledger_activity_history() returns trigger language plpgsql as $$
begin if auth.uid() is not null then raise exception 'Activity history is append-only'; end if; return coalesce(new, old); end $$;
drop trigger if exists trg_protect_activity on public.activity_history;
create trigger trg_protect_activity before update or delete on public.activity_history for each row execute function public.protect_ledger_activity_history();

create or replace function public.set_faculty_context() returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if tg_op = 'INSERT' then new.created_by := coalesce(auth.uid(), new.created_by); else new.created_by := old.created_by; end if;
  new.updated_by := coalesce(auth.uid(), new.updated_by); new.updated_at := now(); return new;
end $$;
drop trigger if exists trg_faculty_ctx on public.faculty;
create trigger trg_faculty_ctx before insert or update on public.faculty for each row execute function public.set_faculty_context();
create or replace function public.set_fep_context() returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if tg_op = 'INSERT' then new.created_by := coalesce(auth.uid(), new.created_by); end if;
  new.updated_by := coalesce(auth.uid(), new.updated_by); new.updated_at := now();
  if not exists (select 1 from public.faculty_expense_categories c where c.id = new.expense_category_id and c.is_active) then raise exception 'Expense category inactive or missing'; end if;
  return new;
end $$;
drop trigger if exists trg_fep_ctx on public.faculty_expense_payments;
create trigger trg_fep_ctx before insert or update on public.faculty_expense_payments for each row execute function public.set_fep_context();

-- link timetable rows to the teacher's Auth user when faculty.user_id / employee_id changes
create or replace function public.link_timetable_teacher() returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if new.user_id is not null then update public.timetable set teacher_id = new.user_id where row_kind='period' and teacher_code = new.employee_id; end if;
  return new;
end $$;
drop trigger if exists trg_link_timetable on public.faculty;
create trigger trg_link_timetable after insert or update of user_id, employee_id on public.faculty for each row execute function public.link_timetable_teacher();

-- ===== RPCs ======================================================================
create or replace function public.pay_faculty_salary(p_faculty_id uuid, p_expense_category_id uuid, p_payment_date date, p_voucher_number text,
  p_amount numeric, p_payment_mode text, p_remarks text, p_transaction_head text, p_transaction_main_category text, p_transaction_sub_category text)
returns uuid language plpgsql security definer set search_path = public, pg_temp as $$
declare v_user uuid := auth.uid(); v_tx integer; v_pay uuid; v_mode text;
begin
  if v_user is null then raise exception 'Not authenticated'; end if;
  if not public.has_ledger_access() then raise exception 'Ledger access denied'; end if;
  if p_amount is null or p_amount <= 0 then raise exception 'Amount must be positive'; end if;
  if not exists (select 1 from public.faculty where id = p_faculty_id and status = 'active') then raise exception 'Faculty not found or inactive'; end if;
  v_mode := lower(trim(coalesce(p_payment_mode,'cash')));
  v_mode := case when v_mode in ('bank','bank_transfer','bank transfer','neft','rtgs','imps') then 'bank_transfer'
                 when v_mode in ('cheque','check') then 'cheque' when v_mode in ('upi','qr') then 'upi' when v_mode = 'cash' then 'cash' else 'other' end;
  insert into public.transactions(type,date,reference,particulars,amount,head,main_category,sub_category,user_id,created_by)
  values ('expense',p_payment_date,p_voucher_number,coalesce(p_remarks,'Faculty Salary Payment'),p_amount,coalesce(p_transaction_head,'Expenses'),
          coalesce(p_transaction_main_category,'Faculty Expenses'),coalesce(p_transaction_sub_category,'Salary'),v_user,v_user::text)
  returning id into v_tx;
  insert into public.faculty_expense_payments(faculty_id,expense_category_id,transaction_id,payment_date,voucher_number,amount,payment_mode,remarks,created_by,updated_by)
  values (p_faculty_id,p_expense_category_id,v_tx,p_payment_date,p_voucher_number,p_amount,v_mode,p_remarks,v_user,v_user) returning id into v_pay;
  return v_pay;
end $$;
revoke all on function public.pay_faculty_salary from public, anon; grant execute on function public.pay_faculty_salary to authenticated;

-- principal/admin: activate/deactivate a teacher (faculty row + login)
create or replace function public.set_faculty_active(p_faculty_id uuid, p_active boolean) returns void language plpgsql security definer set search_path = public, pg_temp as $$
declare uid uuid;
begin
  if not public.is_staff_manager() then raise exception 'Not allowed'; end if;
  update public.faculty set status = case when p_active then 'active' else 'inactive' end where id = p_faculty_id returning user_id into uid;
  if not found then raise exception 'Faculty not found'; end if;
  if uid is not null then
    if uid = auth.uid() then raise exception 'You cannot deactivate yourself'; end if;
    update public.users set is_active = p_active where id = uid and role in ('teacher','hod','student','accountant');
  end if;
end $$;
revoke all on function public.set_faculty_active from public, anon; grant execute on function public.set_faculty_active to authenticated;

-- Timetable editor save: atomic replace + optimistic concurrency (SECURITY INVOKER so RLS authorises)
create or replace function public.save_timetable(p_working jsonb, p_master jsonb, p_config jsonb, p_expected_version bigint)
returns jsonb language plpgsql security invoker set search_path = public, pg_temp as $$
declare cur bigint; newv bigint; uid uuid := auth.uid();
begin
  if not public.is_staff_manager() then raise exception 'Not allowed to edit the timetable'; end if;
  perform pg_advisory_xact_lock(727001);
  select version into cur from public.timetable where row_kind='config' and status='working';
  if p_expected_version is not null and coalesce(cur,0) <> p_expected_version then
    raise exception 'TIMETABLE_CONFLICT' using errcode='P0001', detail=coalesce(cur,0)::text; end if;
  newv := coalesce(cur,0) + 1;
  delete from public.timetable where row_kind='period' and status='working';
  insert into public.timetable(status,row_kind,class_section,day_of_week,period_number,subject,subject_code,teacher_code,teacher_id,combined_group,start_time,end_time,updated_by)
  select 'working','period',r.class_section,r.day_of_week,r.period_number,coalesce(r.subject,''),r.subject_code,r.teacher_code,
         (select f.user_id from public.faculty f where f.employee_id = r.teacher_code),r.combined_group,r.start_time,r.end_time,uid
  from jsonb_to_recordset(coalesce(p_working,'[]'::jsonb)) as r(class_section text, day_of_week int, period_number int, subject text, subject_code text,
       teacher_code text, combined_group text, start_time time, end_time time);
  if p_master is not null then
    delete from public.timetable where row_kind='period' and status='master';
    insert into public.timetable(status,row_kind,class_section,day_of_week,period_number,subject,subject_code,teacher_code,teacher_id,combined_group,start_time,end_time,updated_by)
    select 'master','period',r.class_section,r.day_of_week,r.period_number,coalesce(r.subject,''),r.subject_code,r.teacher_code,
           (select f.user_id from public.faculty f where f.employee_id = r.teacher_code),r.combined_group,r.start_time,r.end_time,uid
    from jsonb_to_recordset(p_master) as r(class_section text, day_of_week int, period_number int, subject text, subject_code text,
         teacher_code text, combined_group text, start_time time, end_time time);
  end if;
  insert into public.timetable(status,row_kind,payload,version,updated_by,updated_at) values ('working','config',coalesce(p_config,'{}'::jsonb),newv,uid,now())
  on conflict (status) where row_kind='config' do update set payload=excluded.payload, version=excluded.version, updated_by=excluded.updated_by, updated_at=excluded.updated_at;
  return jsonb_build_object('version', newv);
end $$;
revoke all on function public.save_timetable from public, anon; grant execute on function public.save_timetable to authenticated;

-- Teacher diary: my periods for a date = published (master) timetable + date overrides/substitutions from the editor
create or replace function public.get_my_periods(p_date date)
returns table(period_number int, class_section text, subject text, start_time time, end_time time)
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare uid uuid := auth.uid(); dow int := extract(isodow from p_date)::int; code text; cfg jsonb;
begin
  if uid is null or public.get_my_role() is null then raise exception 'Not authenticated'; end if;
  select f.employee_id into code from public.faculty f where f.user_id = uid limit 1;
  select t.payload into cfg from public.timetable t where t.row_kind='config' and t.status='working';
  return query
  with eff as (
    select t.class_section cs, t.period_number pn, t.teacher_code tc, t.teacher_id tid, t.subject subj, t.start_time st, t.end_time et
    from public.timetable t where t.row_kind='period' and t.status='master' and t.day_of_week = dow),
  ov as (
    select c.key cs, regexp_replace(p.key,'\D','','g')::int pn, p.value->>'teacher' tc, p.value->>'subject' sc
    from jsonb_each(coalesce(cfg->'dateOverrides'->(p_date::text), '{}'::jsonb)) c, jsonb_each(c.value) p
    where jsonb_typeof(c.value)='object' and p.key ~ '^P[0-9]+$'),
  merged as (
    select coalesce(e.cs,o.cs) cs, coalesce(e.pn,o.pn) pn,
      case when o.cs is not null then o.tc else e.tc end tc,
      case when o.cs is not null then null::uuid else e.tid end tid,
      case when o.cs is not null then coalesce(cfg->'subjects'->o.sc->>'name', o.sc, '') else e.subj end subj, e.st, e.et
    from eff e full join ov o on e.cs = o.cs and e.pn = o.pn)
  select m.pn, m.cs, m.subj,
    coalesce(m.st, nullif(cfg->'settings'->'periodTimes'->('P'||m.pn)->>'start','')::time),
    coalesce(m.et, nullif(cfg->'settings'->'periodTimes'->('P'||m.pn)->>'end','')::time)
  from merged m where m.tid = uid or (code is not null and m.tc = code) order by m.pn, m.cs;
end $$;
revoke all on function public.get_my_periods from public, anon; grant execute on function public.get_my_periods to authenticated;

-- ===== RLS: ledger & people ======================================================
do $$ declare t text; begin
  foreach t in array array['categories','tags','students','transactions','transaction_revisions','activity_history','user_profiles','fee_structures',
    'fee_payments','student_fee_assignments','faculty','faculty_expense_categories','faculty_expense_payments'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on public.%I from anon', t);
  end loop; end $$;

do $$ declare t text; begin
  -- readers: ledger roles; writers insert/update: ledger roles; delete: admin
  foreach t in array array['categories','tags','fee_structures','fee_payments','student_fee_assignments','transactions','transaction_revisions'] loop
    execute format('drop policy if exists %I on public.%I', t||'_sel', t);
    execute format('drop policy if exists %I on public.%I', t||'_ins', t);
    execute format('drop policy if exists %I on public.%I', t||'_upd', t);
    execute format('drop policy if exists %I on public.%I', t||'_del', t);
    execute format('create policy %I on public.%I for select to authenticated using (public.has_ledger_access())', t||'_sel', t);
    execute format('create policy %I on public.%I for insert to authenticated with check (public.has_ledger_access())', t||'_ins', t);
    if t <> 'transaction_revisions' then
      execute format('create policy %I on public.%I for update to authenticated using (public.has_ledger_access()) with check (public.has_ledger_access())', t||'_upd', t);
    end if;
    execute format('create policy %I on public.%I for delete to authenticated using (public.is_admin_role())', t||'_del', t);
  end loop;
  -- fee structures / categories / tags structure edits stay admin+principal-level writers as above
end $$;

drop policy if exists activity_sel on public.activity_history; drop policy if exists activity_ins on public.activity_history;
create policy activity_sel on public.activity_history for select to authenticated using (public.is_ledger_principal());
create policy activity_ins on public.activity_history for insert to authenticated with check (public.has_ledger_access());

drop policy if exists up_sel on public.user_profiles; drop policy if exists up_ins on public.user_profiles; drop policy if exists up_upd on public.user_profiles;
create policy up_sel on public.user_profiles for select to authenticated using (email = (select u.email from public.users u where u.id = auth.uid()) or public.is_ledger_principal());
create policy up_ins on public.user_profiles for insert to authenticated with check (email = (select u.email from public.users u where u.id = auth.uid()));
create policy up_upd on public.user_profiles for update to authenticated using (email = (select u.email from public.users u where u.id = auth.uid()))
  with check (email = (select u.email from public.users u where u.id = auth.uid()));

drop policy if exists st_sel on public.students; drop policy if exists st_ins on public.students; drop policy if exists st_upd on public.students; drop policy if exists st_del on public.students;
create policy st_sel on public.students for select to authenticated using (user_id = auth.uid() or public.has_ledger_access() or public.can_read_all_staff());
create policy st_ins on public.students for insert to authenticated with check (public.has_ledger_access() or public.is_staff_manager());
create policy st_upd on public.students for update to authenticated using (public.has_ledger_access() or public.is_staff_manager()) with check (public.has_ledger_access() or public.is_staff_manager());
create policy st_del on public.students for delete to authenticated using (public.is_admin_role() or public.get_my_role() = 'principal');

drop policy if exists fac_sel on public.faculty; drop policy if exists fac_ins on public.faculty; drop policy if exists fac_upd on public.faculty;
create policy fac_sel on public.faculty for select to authenticated using (user_id = auth.uid() or public.has_ledger_access() or public.can_read_all_staff());
create policy fac_ins on public.faculty for insert to authenticated with check (public.has_ledger_access() or public.is_staff_manager());
create policy fac_upd on public.faculty for update to authenticated using (public.has_ledger_access() or public.is_staff_manager()) with check (public.has_ledger_access() or public.is_staff_manager());

drop policy if exists fec_sel on public.faculty_expense_categories; drop policy if exists fec_w on public.faculty_expense_categories;
create policy fec_sel on public.faculty_expense_categories for select to authenticated using (public.has_ledger_access());
create policy fec_w on public.faculty_expense_categories for all to authenticated using (public.is_admin_role()) with check (public.is_admin_role());
drop policy if exists fep_sel on public.faculty_expense_payments; drop policy if exists fep_ins on public.faculty_expense_payments;
create policy fep_sel on public.faculty_expense_payments for select to authenticated using (public.has_ledger_access());
create policy fep_ins on public.faculty_expense_payments for insert to authenticated with check (public.has_ledger_access());

-- students read their own class timetable (match class/section loosely: '10-A' ~ 'Class-10-A')
create or replace function public.student_class_key(c text, s text) returns text language sql immutable as
$$ select regexp_replace(upper(coalesce(c,'')||coalesce(s,'')), '[^A-Z0-9]', '', 'g') $$;
drop policy if exists tt_student_select on public.timetable;
create policy tt_student_select on public.timetable for select to authenticated using (
  row_kind='period' and status='master' and public.get_my_role()='student' and exists (
    select 1 from public.students s where s.user_id = auth.uid() and s.is_active
      and regexp_replace(regexp_replace(upper(class_section),'^CLASS',''),'[^A-Z0-9]','','g') = public.student_class_key(s.class, s.section)));

-- reporting views (caller's RLS applies)
create or replace view public.faculty_salary_register with (security_invoker = true) as
 select p.id payment_id, f.employee_id, f.faculty_name, f.department, f.designation, f.status, p.payment_date, p.voucher_number, p.amount,
        c.name expense_category, p.payment_mode, p.remarks, p.created_at
 from public.faculty_expense_payments p join public.faculty f on f.id=p.faculty_id join public.faculty_expense_categories c on c.id=p.expense_category_id;
create or replace view public.faculty_monthly_salary_report with (security_invoker = true) as
 select date_trunc('month', p.payment_date)::date as month, count(*) payment_count, sum(p.amount) total_amount
 from public.faculty_expense_payments p join public.faculty_expense_categories c on c.id=p.expense_category_id where c.name='Salary' group by 1;
create or replace view public.faculty_department_expense_report with (security_invoker = true) as
 select f.department, c.name expense_category, count(*) payment_count, sum(p.amount) total_amount
 from public.faculty_expense_payments p join public.faculty f on f.id=p.faculty_id join public.faculty_expense_categories c on c.id=p.expense_category_id group by 1,2;
create or replace view public.faculty_dashboard_summary with (security_invoker = true) as
 select (select count(*) from public.faculty) total_faculty, (select count(*) from public.faculty where status='active') active_faculty,
        coalesce((select sum(p.amount) from public.faculty_expense_payments p join public.faculty_expense_categories c on c.id=p.expense_category_id
                  where c.name='Salary' and date_trunc('month',p.payment_date)=date_trunc('month',current_date)),0) current_month_salary_paid,
        coalesce((select sum(amount) from public.faculty_expense_payments),0) total_faculty_expenses;

-- ===== Storage (private buckets) + Realtime =======================================
insert into storage.buckets(id,name,public) values ('period_files','period_files',false),('receipts','receipts',false) on conflict (id) do update set public=false;
drop policy if exists pf_ins on storage.objects; drop policy if exists pf_sel on storage.objects; drop policy if exists pf_upd on storage.objects; drop policy if exists pf_del on storage.objects;
create policy pf_ins on storage.objects for insert to authenticated with check (bucket_id='period_files' and (storage.foldername(name))[1] = auth.uid()::text);
create policy pf_sel on storage.objects for select to authenticated using (bucket_id='period_files' and ((storage.foldername(name))[1] = auth.uid()::text or public.can_read_all_staff()));
create policy pf_upd on storage.objects for update to authenticated using (bucket_id='period_files' and (storage.foldername(name))[1] = auth.uid()::text);
create policy pf_del on storage.objects for delete to authenticated using (bucket_id='period_files' and (storage.foldername(name))[1] = auth.uid()::text);
drop policy if exists rc_ins on storage.objects; drop policy if exists rc_sel on storage.objects; drop policy if exists rc_upd on storage.objects; drop policy if exists rc_del on storage.objects;
create policy rc_ins on storage.objects for insert to authenticated with check (bucket_id='receipts' and public.has_ledger_access());
create policy rc_sel on storage.objects for select to authenticated using (bucket_id='receipts' and public.has_ledger_access());
create policy rc_upd on storage.objects for update to authenticated using (bucket_id='receipts' and public.has_ledger_access());
create policy rc_del on storage.objects for delete to authenticated using (bucket_id='receipts' and public.is_admin_role());

do $$ begin
  if not exists (select 1 from pg_publication_tables where pubname='supabase_realtime' and tablename='notifications') then alter publication supabase_realtime add table public.notifications; end if;
  if not exists (select 1 from pg_publication_tables where pubname='supabase_realtime' and tablename='timetable') then alter publication supabase_realtime add table public.timetable; end if;
end $$;
