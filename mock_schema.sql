-- Create schemas
CREATE SCHEMA IF NOT EXISTS auth;
CREATE SCHEMA IF NOT EXISTS public;

CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid AS $$
BEGIN
    RETURN '00000000-0000-0000-0000-000000000000'::uuid;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION auth.role() RETURNS text AS $$
BEGIN
    RETURN 'authenticated';
END;
$$ LANGUAGE plpgsql;

DO $$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_catalog.pg_roles WHERE rolname = 'anon') THEN
    CREATE ROLE anon;
  END IF;
  IF NOT EXISTS (SELECT FROM pg_catalog.pg_roles WHERE rolname = 'authenticated') THEN
    CREATE ROLE authenticated;
  END IF;
END
$$;



-- Mock auth.users
CREATE TABLE auth.users (
    id UUID PRIMARY KEY,
    email TEXT,
    raw_user_meta_data JSONB
);

-- Mock Phase 0 Legacy Tables
CREATE TABLE public.boards (
    id SERIAL PRIMARY KEY,
    name TEXT,
    display_order INT DEFAULT 0
);

CREATE TABLE public.classes (
    id SERIAL PRIMARY KEY,
    name TEXT,
    display_order INT DEFAULT 0
);

CREATE TABLE public.subjects (
    id SERIAL PRIMARY KEY,
    name TEXT,
    display_order INT DEFAULT 0
);

CREATE TABLE public.students (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    admission_number VARCHAR(50) UNIQUE,
    name TEXT,
    roll_number VARCHAR(50),
    school_id UUID
);

CREATE TABLE public.fee_payments (
    id SERIAL PRIMARY KEY,
    student_admission_number VARCHAR(50), -- Legacy column
    student_id UUID,
    school_id UUID,
    amount NUMERIC
);
-- Legacy FK
ALTER TABLE public.fee_payments ADD CONSTRAINT fee_payments_student_admission_number_fkey FOREIGN KEY (student_admission_number) REFERENCES public.students(admission_number);

CREATE TABLE public.student_fee_assignments (
    id SERIAL PRIMARY KEY,
    student_id VARCHAR(50), -- Legacy column
    student_uuid UUID,
    school_id UUID,
    fee_amount NUMERIC
);
-- Legacy FK
ALTER TABLE public.student_fee_assignments ADD CONSTRAINT student_fee_assignments_student_id_fkey FOREIGN KEY (student_id) REFERENCES public.students(admission_number);

CREATE TABLE public.slow_learner_entries (
    id SERIAL PRIMARY KEY,
    student_id VARCHAR(50), -- Legacy column
    teacher_id UUID,
    student_uuid UUID,
    student_name TEXT,
    notes TEXT
);
-- Legacy FK
ALTER TABLE public.slow_learner_entries ADD CONSTRAINT slow_learner_entries_student_id_fkey FOREIGN KEY (student_id) REFERENCES public.students(admission_number);

-- Populate some dummy data
INSERT INTO public.students (admission_number, name) VALUES 
('A001', 'Alice'),
('A002', 'Bob');

INSERT INTO public.fee_payments (student_admission_number, amount) VALUES 
('A001', 100.00),
('A002', 200.00);

INSERT INTO public.student_fee_assignments (student_id, fee_amount) VALUES 
('A001', 50.00);

INSERT INTO public.slow_learner_entries (student_id, notes) VALUES 
('A002', 'Needs more time on tests');
