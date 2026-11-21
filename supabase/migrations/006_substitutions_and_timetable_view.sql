-- 006: view-for-everyone timetable, teacher substitutions and takeover requests.
-- NO new tables. Substitutions are stored where the Timetable Editor already keeps them:
--   public.timetable config row -> payload.dateOverrides[date][class_section]['P<n>'] (+ payload.substitutedCells)
-- Takeover requests use the existing public.notifications table.

-- 1) Read-only timetable for every signed-in, active user (no draft/working periods, no event log).
create or replace function public.get_timetable_view() returns jsonb
language plpgsql stable security definer set search_path to 'public','pg_temp' as $$
declare r jsonb;
begin
  if auth.uid() is null or public.get_my_role() is null then raise exception 'Not authenticated'; end if;
  select coalesce(jsonb_agg(x), '[]'::jsonb) into r from (
    select row_kind, status, class_section, day_of_week, period_number, subject, subject_code, teacher_code, combined_group,
           case when row_kind = 'config' then (payload - 'eventLogs') else payload end as payload, version
    from public.timetable
    where (row_kind = 'config' and status = 'working') or (row_kind = 'period' and status = 'master')
  ) x;
  return r;
end $$;

-- 2) Whole-school schedule for one date (master + substitutions). Teachers need it to ask for a period.
create or replace function public.get_day_schedule(p_date date)
returns table(period_number int, class_section text, subject text, subject_code text, start_time time, end_time time,
              teacher_code text, teacher_name text, teacher_user_id uuid, substituted boolean)
language plpgsql stable security definer set search_path to 'public','pg_temp' as $$
declare dow int := extract(isodow from p_date)::int; cfg jsonb;
begin
  if auth.uid() is null or public.get_my_role() is null then raise exception 'Not authenticated'; end if;
  select t.payload into cfg from public.timetable t where t.row_kind='config' and t.status='working';
  return query
  with eff as (
    select t.class_section cs, t.period_number pn, t.teacher_code tc, t.subject_code sc, t.subject subj, t.start_time st, t.end_time et
    from public.timetable t where t.row_kind='period' and t.status='master' and t.day_of_week = dow),
  ov as (
    select c.key cs, regexp_replace(p.key,'\D','','g')::int pn, p.value->>'teacher' tc, p.value->>'subject' sc
    from jsonb_each(coalesce(cfg->'dateOverrides'->(p_date::text),'{}'::jsonb)) c, jsonb_each(c.value) p
    where jsonb_typeof(c.value)='object' and p.key ~ '^P[0-9]+$'),
  merged as (
    select coalesce(e.cs,o.cs) cs, coalesce(e.pn,o.pn) pn,
      case when o.cs is not null then o.tc else e.tc end tc,
      case when o.cs is not null then coalesce(o.sc,e.sc) else e.sc end sc,
      case when o.cs is not null then coalesce(cfg->'subjects'->coalesce(o.sc,e.sc)->>'name', o.sc, e.subj, '') else e.subj end subj,
      (o.cs is not null) subd, e.st, e.et
    from eff e full join ov o on e.cs = o.cs and e.pn = o.pn)
  select m.pn, m.cs, m.subj, m.sc,
    coalesce(m.st, nullif(cfg->'settings'->'periodTimes'->('P'||m.pn)->>'start','')::time),
    coalesce(m.et, nullif(cfg->'settings'->'periodTimes'->('P'||m.pn)->>'end','')::time),
    m.tc, cfg->'teachers'->m.tc->>'name',
    (select f.user_id from public.faculty f where f.employee_id = m.tc and f.user_id is not null limit 1), m.subd
  from merged m where m.tc is not null order by m.pn, m.cs;
end $$;

-- 3) A teacher's own periods. Adds substitute_for ("covering for X"). Same rules as before otherwise.
drop function if exists public.get_my_periods(date);
create or replace function public.get_my_periods(p_date date)
returns table(period_number integer, class_section text, subject text, start_time time, end_time time, substitute_for text)
language plpgsql stable security definer set search_path to 'public','pg_temp' as $$
declare uid uuid := auth.uid(); dow int := extract(isodow from p_date)::int; code text; cfg jsonb;
begin
  if uid is null or public.get_my_role() is null then raise exception 'Not authenticated'; end if;
  select f.employee_id into code from public.faculty f where f.user_id = uid limit 1;
  select t.payload into cfg from public.timetable t where t.row_kind='config' and t.status='working';
  return query
  with eff as (
    select t.class_section cs, t.period_number pn, t.teacher_code tc, t.teacher_id tid, t.subject_code sc, t.subject subj, t.start_time st, t.end_time et
    from public.timetable t where t.row_kind='period' and t.status='master' and t.day_of_week = dow),
  ov as (
    select c.key cs, regexp_replace(p.key,'\D','','g')::int pn, p.value->>'teacher' tc, p.value->>'subject' sc
    from jsonb_each(coalesce(cfg->'dateOverrides'->(p_date::text), '{}'::jsonb)) c, jsonb_each(c.value) p
    where jsonb_typeof(c.value)='object' and p.key ~ '^P[0-9]+$'),
  merged as (
    select coalesce(e.cs,o.cs) cs, coalesce(e.pn,o.pn) pn,
      case when o.cs is not null then o.tc else e.tc end tc,
      case when o.cs is not null then null::uuid else e.tid end tid,
      case when o.cs is not null then coalesce(cfg->'subjects'->coalesce(o.sc,e.sc)->>'name', o.sc, e.subj, '') else e.subj end subj,
      case when o.cs is not null and e.tc is not null and e.tc is distinct from o.tc then coalesce(cfg->'teachers'->e.tc->>'name', e.tc) end sub_for,
      e.st, e.et
    from eff e full join ov o on e.cs = o.cs and e.pn = o.pn)
  select m.pn, m.cs, m.subj,
    coalesce(m.st, nullif(cfg->'settings'->'periodTimes'->('P'||m.pn)->>'start','')::time),
    coalesce(m.et, nullif(cfg->'settings'->'periodTimes'->('P'||m.pn)->>'end','')::time),
    m.sub_for
  from merged m where m.tid = uid or (code is not null and m.tc = code) order by m.pn, m.cs;
end $$;

-- 4) Internal helper: write / remove one override in the config row (not callable from the browser).
create or replace function public.tt_set_override(p_date date, p_cs text, p_period int, p_teacher text, p_subject text, p_reason text, p_orig text, p_clear boolean)
returns void language plpgsql security definer set search_path to 'public','pg_temp' as $$
declare cfg jsonb; ov jsonb; d jsonb; c jsonb; sc jsonb; k text := 'P'||p_period; sk text := p_cs||'|'||p_date::text||'|'||k;
begin
  select payload into cfg from public.timetable where row_kind='config' and status='working' for update;
  if cfg is null then raise exception 'No timetable configuration exists yet'; end if;
  ov := coalesce(cfg->'dateOverrides','{}'::jsonb);
  d := coalesce(ov->(p_date::text),'{}'::jsonb);
  c := coalesce(d->p_cs,'{}'::jsonb);
  sc := coalesce(cfg->'substitutedCells','{}'::jsonb);
  if p_clear then
    c := c - k; sc := sc - sk;
  else
    c := c || jsonb_build_object(k, jsonb_build_object('subject', p_subject, 'teacher', p_teacher, 'combined', null,
           'reason', p_reason, 'originalTeacher', p_orig, 'assignedBy', auth.uid()));
    sc := sc || jsonb_build_object(sk, true);
  end if;
  if c = '{}'::jsonb then d := d - p_cs; else d := d || jsonb_build_object(p_cs, c); end if;
  if d = '{}'::jsonb then ov := ov - (p_date::text); else ov := ov || jsonb_build_object(p_date::text, d); end if;
  update public.timetable set payload = payload || jsonb_build_object('dateOverrides', ov, 'substitutedCells', sc),
         version = version + 1, updated_at = now(), updated_by = auth.uid()
   where row_kind='config' and status='working';
end $$;

-- 5) Principal / vice principal / admin: choose a free teacher for a period (overrides anything, incl. a declined request).
create or replace function public.list_substitute_candidates(p_date date, p_period int)
returns table(user_id uuid, name text, code text)
language plpgsql stable security definer set search_path to 'public','pg_temp' as $$
begin
  if not public.is_staff_manager() then raise exception 'Only the principal or admin can do this'; end if;
  return query
  select f.user_id, coalesce(c.payload->'teachers'->f.employee_id->>'name', f.faculty_name), f.employee_id
  from public.faculty f
  join public.users u on u.id = f.user_id and u.is_active and u.role in ('teacher','hod')
  left join public.timetable c on c.row_kind='config' and c.status='working'
  where f.status='active' and f.user_id is not null
    and not exists (select 1 from public.get_day_schedule(p_date) s where s.period_number = p_period and s.teacher_code = f.employee_id)
  order by 2;
end $$;

create or replace function public.assign_substitute(p_date date, p_class_section text, p_period int, p_substitute uuid, p_reason text default null)
returns jsonb language plpgsql security definer set search_path to 'public','pg_temp' as $$
declare cur record; newcode text; nm text; cfg jsonb;
begin
  if not public.is_staff_manager() then raise exception 'Only the principal or admin can assign a substitute'; end if;
  select * into cur from public.get_day_schedule(p_date) s where s.class_section = p_class_section and s.period_number = p_period;
  if not found then raise exception 'There is no such period on that date'; end if;
  select f.employee_id into newcode from public.faculty f join public.users u on u.id = f.user_id
   where f.user_id = p_substitute and f.status='active' and u.is_active and u.role in ('teacher','hod');
  if newcode is null then raise exception 'The substitute must be an active teacher'; end if;
  if newcode = cur.teacher_code then raise exception 'That teacher already takes this period'; end if;
  if exists (select 1 from public.get_day_schedule(p_date) s where s.period_number = p_period and s.teacher_code = newcode) then
    raise exception 'That teacher already has a class in period %', p_period; end if;
  perform public.tt_set_override(p_date, p_class_section, p_period, newcode, cur.subject_code, p_reason, cur.teacher_code, false);
  select payload into cfg from public.timetable where row_kind='config' and status='working';
  nm := coalesce(cfg->'teachers'->cur.teacher_code->>'name', cur.teacher_code);
  insert into public.notifications(user_id, type, title, message, related_date)
  values (p_substitute, 'substitution_assigned', 'Substitution assigned',
          format('Please take period %s of %s on %s (covering %s).%s', p_period, p_class_section, p_date, nm, coalesce(' Note: '||p_reason,'')), p_date);
  if cur.teacher_user_id is not null then
    insert into public.notifications(user_id, type, title, message, related_date)
    values (cur.teacher_user_id, 'substitution_assigned', 'Your period was reassigned',
            format('Period %s of %s on %s will be taken by another teacher.', p_period, p_class_section, p_date), p_date);
  end if;
  return jsonb_build_object('ok', true, 'teacher_code', newcode);
end $$;

create or replace function public.clear_substitution(p_date date, p_class_section text, p_period int)
returns jsonb language plpgsql security definer set search_path to 'public','pg_temp' as $$
begin
  if not public.is_staff_manager() then raise exception 'Only the principal or admin can do this'; end if;
  perform public.tt_set_override(p_date, p_class_section, p_period, null, null, null, null, true);
  return jsonb_build_object('ok', true);
end $$;

-- 6) Teacher asks to take another teacher's period; the owner must accept. Principal/admin can still override.
create or replace function public.request_takeover(p_date date, p_class_section text, p_period int)
returns jsonb language plpgsql security definer set search_path to 'public','pg_temp' as $$
declare uid uuid := auth.uid(); mycode text; cur record; me text;
begin
  if coalesce(public.get_my_role(),'') not in ('teacher','hod') then raise exception 'Only teachers can request a period'; end if;
  if p_date < current_date then raise exception 'You cannot request a period in the past'; end if;
  select f.employee_id into mycode from public.faculty f where f.user_id = uid and f.status='active';
  if mycode is null then raise exception 'Your account is not linked to a faculty record'; end if;
  select * into cur from public.get_day_schedule(p_date) s where s.class_section = p_class_section and s.period_number = p_period;
  if not found then raise exception 'There is no such period on that date'; end if;
  if cur.teacher_user_id is null then raise exception 'That period has no teacher account to ask'; end if;
  if cur.teacher_user_id = uid then raise exception 'That is already your period'; end if;
  if exists (select 1 from public.get_day_schedule(p_date) s where s.period_number = p_period and s.teacher_code = mycode) then
    raise exception 'You already have a class in period %', p_period; end if;
  if exists (select 1 from public.notifications n where n.type='takeover_request' and n.user_id = cur.teacher_user_id
             and n.related_date = p_date and n.related_entry_ids = array[p_class_section, p_period::text, uid::text]) then
    raise exception 'You have already asked for this period'; end if;
  select coalesce(name, email) into me from public.users where id = uid;
  insert into public.notifications(user_id, type, title, message, related_date, related_entry_ids)
  values (cur.teacher_user_id, 'takeover_request', 'Period takeover request',
          format('%s asks to take your period %s (%s) of %s on %s. Open Substitutions to approve or decline.', me, p_period, cur.subject, p_class_section, p_date),
          p_date, array[p_class_section, p_period::text, uid::text]);
  return jsonb_build_object('ok', true);
end $$;

create or replace function public.list_my_takeover_requests()
returns table(id uuid, related_date date, class_section text, period_number int, requester_name text, created_at timestamptz)
language sql stable security definer set search_path to 'public','pg_temp' as $$
  select n.id, n.related_date, n.related_entry_ids[1], n.related_entry_ids[2]::int,
         coalesce((select coalesce(u.name,u.email) from public.users u where u.id = n.related_entry_ids[3]::uuid), 'A teacher'), n.created_at
  from public.notifications n
  where n.user_id = auth.uid() and n.type = 'takeover_request' and n.related_date >= current_date
  order by n.related_date, n.created_at;
$$;

create or replace function public.respond_takeover(p_request_id uuid, p_accept boolean)
returns jsonb language plpgsql security definer set search_path to 'public','pg_temp' as $$
declare n record; rid uuid; cs text; pn int; cur record; rcode text; me text;
begin
  select * into n from public.notifications where id = p_request_id and user_id = auth.uid() and type = 'takeover_request' for update;
  if not found then raise exception 'This request is no longer open'; end if;
  rid := n.related_entry_ids[3]::uuid; cs := n.related_entry_ids[1]; pn := n.related_entry_ids[2]::int;
  select coalesce(name,email) into me from public.users where id = auth.uid();
  if p_accept then
    select * into cur from public.get_day_schedule(n.related_date) s where s.class_section = cs and s.period_number = pn;
    if not found or cur.teacher_user_id is distinct from auth.uid() then raise exception 'This period is no longer yours to give'; end if;
    select f.employee_id into rcode from public.faculty f join public.users u on u.id = f.user_id
     where f.user_id = rid and f.status='active' and u.is_active;
    if rcode is null then raise exception 'The requesting teacher is not active'; end if;
    if exists (select 1 from public.get_day_schedule(n.related_date) s where s.period_number = pn and s.teacher_code = rcode) then
      raise exception 'The requesting teacher now has a class in that period'; end if;
    perform public.tt_set_override(n.related_date, cs, pn, rcode, cur.subject_code, 'Approved by ' || me, cur.teacher_code, false);
  end if;
  update public.notifications set type = case when p_accept then 'takeover_accepted' else 'takeover_declined' end, is_read = true where id = n.id;
  insert into public.notifications(user_id, type, title, message, related_date)
  values (rid, 'takeover_result', case when p_accept then 'Period request approved' else 'Period request declined' end,
          format('%s %s your request for period %s of %s on %s.', me, case when p_accept then 'approved' else 'declined' end, pn, cs, n.related_date), n.related_date);
  return jsonb_build_object('ok', true, 'accepted', p_accept);
end $$;

-- 7) Grants: signed-in users only; the internal helper is not callable from the browser.
revoke all on function public.get_timetable_view(), public.get_day_schedule(date), public.get_my_periods(date),
  public.tt_set_override(date,text,int,text,text,text,text,boolean), public.list_substitute_candidates(date,int),
  public.assign_substitute(date,text,int,uuid,text), public.clear_substitution(date,text,int), public.request_takeover(date,text,int),
  public.list_my_takeover_requests(), public.respond_takeover(uuid,boolean) from public, anon, authenticated;
grant execute on function public.get_timetable_view(), public.get_day_schedule(date), public.get_my_periods(date),
  public.list_substitute_candidates(date,int), public.assign_substitute(date,text,int,uuid,text), public.clear_substitution(date,text,int),
  public.request_takeover(date,text,int), public.list_my_takeover_requests(), public.respond_takeover(uuid,boolean) to authenticated;
