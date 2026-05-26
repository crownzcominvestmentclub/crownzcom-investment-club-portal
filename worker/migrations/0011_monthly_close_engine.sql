ALTER TABLE financial_config ADD COLUMN loan_interest_retention_pct REAL NOT NULL DEFAULT 20.0;
ALTER TABLE financial_config ADD COLUMN trust_interest_retention_pct REAL NOT NULL DEFAULT 30.0;

ALTER TABLE interest_monthly ADD COLUMN loan_interest_total INTEGER NOT NULL DEFAULT 0;
ALTER TABLE interest_monthly ADD COLUMN trust_interest_total INTEGER NOT NULL DEFAULT 0;
ALTER TABLE interest_monthly ADD COLUMN loan_interest_retained INTEGER NOT NULL DEFAULT 0;
ALTER TABLE interest_monthly ADD COLUMN trust_interest_retained INTEGER NOT NULL DEFAULT 0;
ALTER TABLE interest_monthly ADD COLUMN loan_interest_distributed INTEGER NOT NULL DEFAULT 0;
ALTER TABLE interest_monthly ADD COLUMN trust_interest_distributed INTEGER NOT NULL DEFAULT 0;
ALTER TABLE interest_monthly ADD COLUMN closed_at INTEGER;
ALTER TABLE interest_monthly ADD COLUMN closed_by TEXT;
ALTER TABLE interest_monthly ADD COLUMN notes TEXT;

UPDATE interest_monthly
SET
  loan_interest_total = CASE WHEN loan_interest_total = 0 AND trust_interest_total = 0 THEN amount ELSE loan_interest_total END,
  loan_interest_distributed = CASE WHEN loan_interest_distributed = 0 AND trust_interest_distributed = 0 THEN amount ELSE loan_interest_distributed END
WHERE amount IS NOT NULL;

CREATE TABLE IF NOT EXISTS retained_earnings_entries (
  id                   TEXT PRIMARY KEY,
  period_month         INTEGER NOT NULL,
  period_year          INTEGER NOT NULL,
  source               TEXT NOT NULL CHECK (source IN ('loan','trust')),
  gross_interest       INTEGER NOT NULL,
  retention_pct        REAL NOT NULL,
  retained_amount      INTEGER NOT NULL,
  distributed_amount   INTEGER NOT NULL,
  created_at           INTEGER NOT NULL,
  closed_by            TEXT,
  notes                TEXT,
  UNIQUE (period_year, period_month, source)
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_interest_allocations_period_member
  ON interest_allocations(member_id, period_year, period_month);
