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
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
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
ADD COLUMN IF NOT EXISTS is_deleted BOOLEAN DEFAULT FALSE;

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
