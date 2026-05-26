-- Extend the D1 schema to preserve Appwrite backup metadata and support Google-based auth.

PRAGMA foreign_keys = ON;

ALTER TABLE members ADD COLUMN membership_number TEXT;
ALTER TABLE members ADD COLUMN appwrite_auth_user_id TEXT;

ALTER TABLE auth_users ADD COLUMN provider TEXT NOT NULL DEFAULT 'local';
ALTER TABLE auth_users ADD COLUMN provider_id TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS idx_members_membership_number ON members(membership_number);
CREATE UNIQUE INDEX IF NOT EXISTS idx_members_appwrite_auth_user_id ON members(appwrite_auth_user_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_auth_users_provider_id ON auth_users(provider_id);

ALTER TABLE loans ADD COLUMN selected_months INTEGER;
ALTER TABLE loans ADD COLUMN repayment_type TEXT;
ALTER TABLE loans ADD COLUMN repayment_plan TEXT;
ALTER TABLE loans ADD COLUMN terms_accepted INTEGER DEFAULT 0 CHECK (terms_accepted IN (0,1));
ALTER TABLE loans ADD COLUMN borrower_coverage INTEGER;

ALTER TABLE early_repayment_requests ADD COLUMN interest_calculation_mode TEXT;
ALTER TABLE early_repayment_requests ADD COLUMN monthly_interest_rate REAL;
ALTER TABLE early_repayment_requests ADD COLUMN penalty_rate REAL;
ALTER TABLE early_repayment_requests ADD COLUMN interest_amount INTEGER;
ALTER TABLE early_repayment_requests ADD COLUMN principal_amount INTEGER;
ALTER TABLE early_repayment_requests ADD COLUMN charge_amount INTEGER;
ALTER TABLE early_repayment_requests ADD COLUMN balance_at_request INTEGER;
ALTER TABLE early_repayment_requests ADD COLUMN requested_for_date INTEGER;
ALTER TABLE early_repayment_requests ADD COLUMN paid_at INTEGER;
ALTER TABLE early_repayment_requests ADD COLUMN admin_comment TEXT;

ALTER TABLE documents ADD COLUMN scope TEXT;
ALTER TABLE documents ADD COLUMN tags TEXT;
ALTER TABLE documents ADD COLUMN period TEXT;
ALTER TABLE documents ADD COLUMN notes TEXT;

ALTER TABLE financial_config ADD COLUMN default_bank_charge INTEGER NOT NULL DEFAULT 0;
ALTER TABLE financial_config ADD COLUMN early_repayment_penalty REAL NOT NULL DEFAULT 0.0;
ALTER TABLE financial_config ADD COLUMN min_loan_amount INTEGER NOT NULL DEFAULT 0;
ALTER TABLE financial_config ADD COLUMN max_loan_amount INTEGER NOT NULL DEFAULT 0;
ALTER TABLE financial_config ADD COLUMN long_term_max_repayment_months INTEGER;
ALTER TABLE financial_config ADD COLUMN interest_calculation_mode TEXT;

CREATE TABLE IF NOT EXISTS interest_allocations (
  id                 TEXT PRIMARY KEY,
  member_id          TEXT NOT NULL REFERENCES members(id) ON DELETE CASCADE,
  loan_interest      INTEGER NOT NULL,
  unit_trust_interest INTEGER NOT NULL,
  total_interest     INTEGER NOT NULL,
  period_month       INTEGER NOT NULL,
  period_year        INTEGER NOT NULL,
  created_at         INTEGER NOT NULL
);
