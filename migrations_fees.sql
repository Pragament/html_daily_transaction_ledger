-- Migration for School Accountant Fee Management Module

-- 1. Create fee_structures table (deprecated, kept for backward compatibility)
CREATE TABLE IF NOT EXISTS fee_structures (
    id SERIAL PRIMARY KEY,
    academic_year TEXT NOT NULL,
    class TEXT NOT NULL,
    fee_type TEXT NOT NULL,
    amount NUMERIC NOT NULL,
    frequency TEXT NOT NULL CHECK (frequency IN ('Monthly', 'Yearly', 'One-Time')),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    UNIQUE (academic_year, class, fee_type)
);

-- 2. Create fee_payments table
CREATE TABLE IF NOT EXISTS fee_payments (
    transaction_id INTEGER PRIMARY KEY REFERENCES transactions(id) ON DELETE CASCADE,
    student_admission_number TEXT NOT NULL REFERENCES students(admission_number) ON DELETE CASCADE,
    academic_year TEXT NOT NULL,
    fee_month TEXT NOT NULL,
    fee_type TEXT NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 3. Create student_fee_assignments table (new)
CREATE TABLE IF NOT EXISTS student_fee_assignments (
    id SERIAL PRIMARY KEY,
    student_id TEXT NOT NULL REFERENCES students(admission_number) ON DELETE CASCADE,
    academic_year TEXT NOT NULL,
    fee_category_id INTEGER NOT NULL REFERENCES categories(id) ON DELETE CASCADE,
    assigned_amount NUMERIC NOT NULL,
    remarks TEXT DEFAULT '',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    UNIQUE (student_id, academic_year, fee_category_id)
);

-- 4. Alter categories table to support frequency dynamically
ALTER TABLE categories ADD COLUMN IF NOT EXISTS frequency TEXT DEFAULT 'Yearly' CHECK (frequency IN ('Monthly', 'Yearly', 'One-Time'));

-- 5. Create indexes for quick fee calculation queries
CREATE INDEX IF NOT EXISTS idx_fee_structures_class_year ON fee_structures(class, academic_year);
CREATE INDEX IF NOT EXISTS idx_fee_payments_student_year ON fee_payments(student_admission_number, academic_year);
CREATE INDEX IF NOT EXISTS idx_fee_payments_month ON fee_payments(fee_month);
CREATE INDEX IF NOT EXISTS idx_student_fee_assignments_lookup ON student_fee_assignments(student_id, academic_year);

-- 6. Enable Row Level Security (RLS)
ALTER TABLE fee_structures ENABLE ROW LEVEL SECURITY;
ALTER TABLE fee_payments ENABLE ROW LEVEL SECURITY;
ALTER TABLE student_fee_assignments ENABLE ROW LEVEL SECURITY;

-- 7. Drop existing policies if they exist (idempotent setup)
DROP POLICY IF EXISTS "Public fee_structures" ON fee_structures;
DROP POLICY IF EXISTS "Public fee_payments" ON fee_payments;
DROP POLICY IF EXISTS "Public student_fee_assignments" ON student_fee_assignments;

-- 8. Create permissive policies for anonymous access (matches other tables in the project)
CREATE POLICY "Public fee_structures" ON fee_structures FOR ALL TO anon USING (true) WITH CHECK (true);
CREATE POLICY "Public fee_payments" ON fee_payments FOR ALL TO anon USING (true) WITH CHECK (true);
CREATE POLICY "Public student_fee_assignments" ON student_fee_assignments FOR ALL TO anon USING (true) WITH CHECK (true);
