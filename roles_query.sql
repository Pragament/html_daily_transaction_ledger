-- 1. Ensure user profile exists in public.users
INSERT INTO public.users (id, email, school_id)
SELECT id, email, '00000000-0000-0000-0000-000000000001'::uuid
FROM auth.users
WHERE email = 'user@example.com'
ON CONFLICT (id) DO NOTHING;

-- 2. Assign 'accountant' role for the Ledger app
INSERT INTO public.app_access (user_id, school_id, app_name, app_role, is_active)
SELECT 
    id, 
    '00000000-0000-0000-0000-000000000001'::uuid, 
    'ledger', 
    'accountant', 
    true
FROM auth.users
WHERE email = 'user@example.com'
ON CONFLICT (user_id, school_id, app_name) 
DO UPDATE SET 
    app_role = 'accountant',
    is_active = true,
    updated_at = now();


-- 1. Ensure user profile exists in public.users
INSERT INTO public.users (id, email, school_id)
SELECT id, email, '00000000-0000-0000-0000-000000000001'::uuid
FROM auth.users
WHERE email = 'user@example.com'
ON CONFLICT (id) DO NOTHING;

-- 2. Assign 'principal' role for the Ledger app
INSERT INTO public.app_access (user_id, school_id, app_name, app_role, is_active)
SELECT 
    id, 
    '00000000-0000-0000-0000-000000000001'::uuid, 
    'ledger', 
    'principal', 
    true
FROM auth.users
WHERE email = 'user@example.com'
ON CONFLICT (user_id, school_id, app_name) 
DO UPDATE SET 
    app_role = 'principal',
    is_active = true,
    updated_at = now();
