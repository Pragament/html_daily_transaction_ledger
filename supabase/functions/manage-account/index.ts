// manage-account: the ONLY place Auth accounts are created/disabled. Uses the service-role key, which Supabase injects
// into Edge Functions as an env var; it never reaches a browser. Caller must be a signed-in admin/principal.
import { createClient } from "npm:@supabase/supabase-js@2";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { ...cors, "Content-Type": "application/json" } });

// who may create which role
const CREATABLE: Record<string, string[]> = {
  super_admin: ["admin", "principal", "vice_principal", "hod", "teacher", "accountant", "student"],
  admin: ["principal", "vice_principal", "hod", "teacher", "accountant", "student"],
  principal: ["teacher", "hod", "student"],
  vice_principal: ["teacher", "student"],
};
const MANAGES: Record<string, string[]> = { // who may (de)activate / reset which target roles
  super_admin: ["admin", "principal", "vice_principal", "hod", "teacher", "accountant", "student"],
  admin: ["principal", "vice_principal", "hod", "teacher", "accountant", "student"],
  principal: ["teacher", "hod", "student"],
  vice_principal: ["teacher", "student"],
};
const tempPassword = () => {
  const a = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789";
  const b = crypto.getRandomValues(new Uint8Array(14));
  return Array.from(b, (x) => a[x % a.length]).join("") + "#7";
};
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "POST only" }, 405);
  const url = Deno.env.get("SUPABASE_URL")!;
  const admin = createClient(url, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });

  const token = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
  const { data: who, error: whoErr } = await admin.auth.getUser(token);
  if (whoErr || !who?.user) return json({ error: "Not signed in" }, 401);
  const { data: caller } = await admin.from("users").select("id, role, is_active").eq("id", who.user.id).maybeSingle();
  if (!caller || !caller.is_active) return json({ error: "Account inactive" }, 403);

  let body: any;
  try { body = await req.json(); } catch { return json({ error: "Invalid JSON" }, 400); }

  try {
    if (body.action === "create_user") {
      const role = String(body.role || "");
      if (!(CREATABLE[caller.role] || []).includes(role)) return json({ error: `Your role (${caller.role}) cannot create a ${role} account` }, 403);
      const email = String(body.email || "").trim().toLowerCase();
      const name = String(body.name || "").trim();
      if (!EMAIL.test(email)) return json({ error: "Valid email required" }, 400);
      if (!name) return json({ error: "Name required" }, 400);
      const f = body.faculty, s = body.student;
      if (["teacher", "hod"].includes(role) && (!f?.employee_id || !f?.department || !f?.designation || !f?.mobile_number || !f?.joining_date))
        return json({ error: "Teacher needs employee_id, department, designation, mobile_number, joining_date" }, 400);
      if (role === "student" && !s?.admission_number) return json({ error: "Student needs admission_number" }, 400);

      // pre-check collisions so we do not create an orphan Auth user
      if (f?.employee_id) {
        const { data: ex } = await admin.from("faculty").select("id,user_id").eq("employee_id", f.employee_id).maybeSingle();
        if (ex?.user_id) return json({ error: "Employee ID already linked to an account" }, 409);
      }
      if (s?.admission_number) {
        const { data: ex } = await admin.from("students").select("user_id").eq("admission_number", s.admission_number).maybeSingle();
        if (ex?.user_id) return json({ error: "Admission number already linked to an account" }, 409);
      }
      const password = body.password && String(body.password).length >= 10 ? String(body.password) : tempPassword();
      const { data: created, error: cErr } = await admin.auth.admin.createUser({
        email, password, email_confirm: true,
        app_metadata: { role }, user_metadata: { full_name: name, must_change_password: true },
      });
      if (cErr || !created?.user) return json({ error: cErr?.message || "Could not create user" }, 400);
      const uid = created.user.id;
      const fail = async (msg: string) => { await admin.auth.admin.deleteUser(uid); return json({ error: msg }, 400); };

      const { error: uErr } = await admin.from("users").upsert({ id: uid, email, name, role, is_active: true }, { onConflict: "id" });
      if (uErr) return await fail("Profile error: " + uErr.message);
      if (f) {
        const row = { employee_id: String(f.employee_id).trim(), faculty_name: name, department: f.department, designation: f.designation,
          mobile_number: f.mobile_number, email, joining_date: f.joining_date, salary: Number(f.salary || 0), status: "active", user_id: uid };
        const { error } = await admin.from("faculty").upsert(row, { onConflict: "employee_id" });
        if (error) return await fail("Faculty error: " + error.message);
      }
      if (s) {
        const row = { admission_number: String(s.admission_number).trim(), name, class: s.class ?? null, section: s.section ?? null,
          roll_number: s.roll_number ?? null, father_name: s.father_name ?? null, phone: s.phone ?? null, email, user_id: uid, is_active: true };
        const { error } = await admin.from("students").upsert(row, { onConflict: "admission_number" });
        if (error) return await fail("Student error: " + error.message);
      }
      return json({ ok: true, user_id: uid, email, role, temporary_password: password });
    }

    if (body.action === "set_active" || body.action === "reset_password") {
      const { data: target } = await admin.from("users").select("id, role").eq("id", body.user_id).maybeSingle();
      if (!target) return json({ error: "User not found" }, 404);
      if (!(MANAGES[caller.role] || []).includes(target.role)) return json({ error: "Not allowed for that account" }, 403);
      if (target.id === caller.id && body.action === "set_active") return json({ error: "You cannot change your own status" }, 400);
      if (body.action === "set_active") {
        const active = !!body.active;
        await admin.auth.admin.updateUserById(target.id, { ban_duration: active ? "none" : "876000h" });
        await admin.from("users").update({ is_active: active }).eq("id", target.id);
        await admin.from("faculty").update({ status: active ? "active" : "inactive" }).eq("user_id", target.id);
        await admin.from("students").update({ is_active: active }).eq("user_id", target.id);
        return json({ ok: true });
      }
      const password = tempPassword();
      const { error } = await admin.auth.admin.updateUserById(target.id, { password, user_metadata: { must_change_password: true } });
      if (error) return json({ error: error.message }, 400);
      return json({ ok: true, temporary_password: password });
    }
    return json({ error: "Unknown action" }, 400);
  } catch (e) {
    return json({ error: String((e as Error).message || e) }, 500);
  }
});
