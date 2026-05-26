-- Extend loan repayment planning metadata and allow optional month-scoped charges.

PRAGMA foreign_keys = ON;

ALTER TABLE loans ADD COLUMN repayment_start_month TEXT
  CHECK(repayment_start_month IS NULL OR repayment_start_month GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]');
ALTER TABLE loans ADD COLUMN first_repayment_date INTEGER;
ALTER TABLE loans ADD COLUMN repayment_day_of_month INTEGER
  CHECK(repayment_day_of_month IS NULL OR (repayment_day_of_month >= 1 AND repayment_day_of_month <= 31));
ALTER TABLE loans ADD COLUMN repayment_plan_version INTEGER NOT NULL DEFAULT 1;
ALTER TABLE loans ADD COLUMN repayment_plan_generated_at INTEGER;
ALTER TABLE loans ADD COLUMN repayment_plan_basis TEXT;

ALTER TABLE loan_charges ADD COLUMN applies_to_month TEXT
  CHECK(applies_to_month IS NULL OR applies_to_month GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]');
