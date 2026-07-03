-- 1. Create categories table
CREATE TABLE IF NOT EXISTS categories (
    id SERIAL PRIMARY KEY,
    name TEXT NOT NULL,
    parent_id INTEGER REFERENCES categories(id) ON DELETE CASCADE,
    type TEXT CHECK (type IN ('income', 'expense', 'all')),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    UNIQUE (name, parent_id)
);

-- 2. Create tags table
CREATE TABLE IF NOT EXISTS tags (
    id SERIAL PRIMARY KEY,
    name TEXT UNIQUE NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 3. Create students table (for CSV import)
CREATE TABLE IF NOT EXISTS students (
    admission_number TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    roll_number TEXT,
    class TEXT,
    section TEXT,
    father_name TEXT,
    phone TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 3.5. Create transactions table
CREATE TABLE IF NOT EXISTS transactions (
    id INTEGER PRIMARY KEY,
    type TEXT NOT NULL CHECK (type IN ('income', 'expense')),
    date DATE NOT NULL,
    reference TEXT,
    particulars TEXT,
    amount NUMERIC NOT NULL,
    head TEXT,
    main_category TEXT,
    sub_category TEXT,
    tags TEXT[] DEFAULT '{}',
    created_by TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_by TEXT,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    deleted_by TEXT,
    is_deleted BOOLEAN DEFAULT FALSE,
    bank_amount NUMERIC DEFAULT 0,
    cheque_count INTEGER DEFAULT 0,
    attachments JSONB DEFAULT '[]'::jsonb
);

-- 4. Alter transactions table (non-destructive)
-- Add columns if they do not exist
ALTER TABLE transactions 
ADD COLUMN IF NOT EXISTS main_category TEXT,
ADD COLUMN IF NOT EXISTS sub_category TEXT,
ADD COLUMN IF NOT EXISTS tags TEXT[] DEFAULT '{}',
ADD COLUMN IF NOT EXISTS created_by TEXT,
ADD COLUMN IF NOT EXISTS created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
ADD COLUMN IF NOT EXISTS updated_by TEXT,
ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
ADD COLUMN IF NOT EXISTS deleted_by TEXT,
ADD COLUMN IF NOT EXISTS is_deleted BOOLEAN DEFAULT FALSE,
ADD COLUMN IF NOT EXISTS bank_amount NUMERIC DEFAULT 0,
ADD COLUMN IF NOT EXISTS cheque_count INTEGER DEFAULT 0,
ADD COLUMN IF NOT EXISTS attachments JSONB DEFAULT '[]'::jsonb;

-- 4.5. Alter students table (non-destructive)
ALTER TABLE students 
ADD COLUMN IF NOT EXISTS class TEXT,
ADD COLUMN IF NOT EXISTS section TEXT,
ADD COLUMN IF NOT EXISTS father_name TEXT,
ADD COLUMN IF NOT EXISTS phone TEXT;

-- 5. Create transaction_revisions table for audit history
CREATE TABLE IF NOT EXISTS transaction_revisions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    transaction_id INTEGER NOT NULL,
    action TEXT NOT NULL CHECK (action IN ('CREATE', 'UPDATE', 'DELETE', 'RESTORE')),
    old_values JSONB,
    new_values JSONB,
    created_by TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 6. Add indexes for performance
CREATE INDEX IF NOT EXISTS idx_transactions_is_deleted ON transactions(is_deleted);
CREATE INDEX IF NOT EXISTS idx_transactions_main_category ON transactions(main_category);
CREATE INDEX IF NOT EXISTS idx_transactions_sub_category ON transactions(sub_category);
CREATE INDEX IF NOT EXISTS idx_revisions_transaction_id ON transaction_revisions(transaction_id);
CREATE INDEX IF NOT EXISTS idx_students_search ON students(name, admission_number, roll_number);

-- 7. Create activity_history table for audit logs
CREATE TABLE IF NOT EXISTS activity_history (
    id UUID PRIMARY KEY,
    timestamp TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    date DATE NOT NULL,
    time TEXT NOT NULL,
    user_name TEXT,
    user_email TEXT,
    firebase_uid TEXT,
    activity_type TEXT NOT NULL,
    transaction_id INTEGER,
    description TEXT,
    device_status TEXT NOT NULL,
    sync_status TEXT DEFAULT 'synced'
);

CREATE INDEX IF NOT EXISTS idx_activity_timestamp ON activity_history(timestamp);
CREATE INDEX IF NOT EXISTS idx_activity_user_email ON activity_history(user_email);
CREATE INDEX IF NOT EXISTS idx_activity_type ON activity_history(activity_type);

-- 8. Create user_profiles table for user details
CREATE TABLE IF NOT EXISTS user_profiles (
    email TEXT PRIMARY KEY,
    full_name TEXT NOT NULL,
    profession TEXT NOT NULL,
    firebase_uid TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 9. Setup Storage Bucket and Policies for receipts
INSERT INTO storage.buckets (id, name, public)
VALUES ('receipts', 'receipts', true)
ON CONFLICT (id) DO NOTHING;

-- Drop existing policies to avoid conflicts
DROP POLICY IF EXISTS "Select receipts" ON storage.objects;
DROP POLICY IF EXISTS "Insert receipts" ON storage.objects;
DROP POLICY IF EXISTS "Update receipts" ON storage.objects;
DROP POLICY IF EXISTS "Delete receipts" ON storage.objects;

-- Create policies for anon and authenticated users on receipts bucket
CREATE POLICY "Select receipts" ON storage.objects FOR SELECT TO anon, authenticated USING (bucket_id = 'receipts');
CREATE POLICY "Insert receipts" ON storage.objects FOR INSERT TO anon, authenticated WITH CHECK (bucket_id = 'receipts');
CREATE POLICY "Update receipts" ON storage.objects FOR UPDATE TO anon, authenticated USING (bucket_id = 'receipts') WITH CHECK (bucket_id = 'receipts');
CREATE POLICY "Delete receipts" ON storage.objects FOR DELETE TO anon, authenticated USING (bucket_id = 'receipts');

-- 10. Verification Queries (run these manually to verify setup)
-- SELECT * FROM storage.buckets;
-- SELECT * FROM pg_policies WHERE schemaname = 'storage';

-- 11. Enable Row Level Security (RLS) and set up policies

-- Enable RLS on all tables
ALTER TABLE categories ENABLE ROW LEVEL SECURITY;
ALTER TABLE tags ENABLE ROW LEVEL SECURITY;
ALTER TABLE students ENABLE ROW LEVEL SECURITY;
ALTER TABLE transactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE transaction_revisions ENABLE ROW LEVEL SECURITY;
ALTER TABLE activity_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_profiles ENABLE ROW LEVEL SECURITY;

-- Drop existing policies if any to ensure idempotency
DROP POLICY IF EXISTS "Select categories" ON categories;
DROP POLICY IF EXISTS "Insert categories" ON categories;
DROP POLICY IF EXISTS "Delete categories" ON categories;

DROP POLICY IF EXISTS "Select tags" ON tags;
DROP POLICY IF EXISTS "Insert tags" ON tags;
DROP POLICY IF EXISTS "Delete tags" ON tags;

DROP POLICY IF EXISTS "Select students" ON students;
DROP POLICY IF EXISTS "Insert students" ON students;
DROP POLICY IF EXISTS "Update students" ON students;
DROP POLICY IF EXISTS "Delete students" ON students;

DROP POLICY IF EXISTS "Select transactions" ON transactions;
DROP POLICY IF EXISTS "Insert transactions" ON transactions;
DROP POLICY IF EXISTS "Update transactions" ON transactions;
DROP POLICY IF EXISTS "Delete transactions" ON transactions;

DROP POLICY IF EXISTS "Select revisions" ON transaction_revisions;
DROP POLICY IF EXISTS "Insert revisions" ON transaction_revisions;

DROP POLICY IF EXISTS "Select activities" ON activity_history;
DROP POLICY IF EXISTS "Insert activities" ON activity_history;

DROP POLICY IF EXISTS "Select profiles" ON user_profiles;
DROP POLICY IF EXISTS "Insert profiles" ON user_profiles;
DROP POLICY IF EXISTS "Update profiles" ON user_profiles;

-- Create policies for categories (SELECT, INSERT, DELETE)
CREATE POLICY "Select categories" ON categories FOR SELECT TO anon USING (true);
CREATE POLICY "Insert categories" ON categories FOR INSERT TO anon WITH CHECK (true);
CREATE POLICY "Delete categories" ON categories FOR DELETE TO anon USING (true);

-- Create policies for tags (SELECT, INSERT, DELETE)
CREATE POLICY "Select tags" ON tags FOR SELECT TO anon USING (true);
CREATE POLICY "Insert tags" ON tags FOR INSERT TO anon WITH CHECK (true);
CREATE POLICY "Delete tags" ON tags FOR DELETE TO anon USING (true);

-- Create policies for students (SELECT, INSERT, UPDATE, DELETE)
CREATE POLICY "Select students" ON students FOR SELECT TO anon USING (true);
CREATE POLICY "Insert students" ON students FOR INSERT TO anon WITH CHECK (true);
CREATE POLICY "Update students" ON students FOR UPDATE TO anon USING (true) WITH CHECK (true);
CREATE POLICY "Delete students" ON students FOR DELETE TO anon USING (true);

-- Create policies for transactions (SELECT, INSERT, UPDATE, DELETE)
CREATE POLICY "Select transactions" ON transactions FOR SELECT TO anon USING (true);
CREATE POLICY "Insert transactions" ON transactions FOR INSERT TO anon WITH CHECK (true);
CREATE POLICY "Update transactions" ON transactions FOR UPDATE TO anon USING (true) WITH CHECK (true);
CREATE POLICY "Delete transactions" ON transactions FOR DELETE TO anon USING (true);

-- Create policies for transaction_revisions (SELECT, INSERT)
CREATE POLICY "Select revisions" ON transaction_revisions FOR SELECT TO anon USING (true);
CREATE POLICY "Insert revisions" ON transaction_revisions FOR INSERT TO anon WITH CHECK (true);

-- Create policies for activity_history (SELECT, INSERT)
CREATE POLICY "Select activities" ON activity_history FOR SELECT TO anon USING (true);
CREATE POLICY "Insert activities" ON activity_history FOR INSERT TO anon WITH CHECK (true);

-- Create policies for user_profiles (SELECT, INSERT, UPDATE)
CREATE POLICY "Select profiles" ON user_profiles FOR SELECT TO anon USING (true);
CREATE POLICY "Insert profiles" ON user_profiles FOR INSERT TO anon WITH CHECK (true);
CREATE POLICY "Update profiles" ON user_profiles FOR UPDATE TO anon USING (true) WITH CHECK (true);

