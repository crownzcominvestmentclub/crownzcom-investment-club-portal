ALTER TABLE financial_config ADD COLUMN max_loan_duration INTEGER NOT NULL DEFAULT 6;
ALTER TABLE financial_config ADD COLUMN long_term_loans_enabled INTEGER NOT NULL DEFAULT 1;

UPDATE financial_config
SET max_loan_duration = COALESCE(max_loan_duration, 6),
    long_term_loans_enabled = COALESCE(long_term_loans_enabled, 1)
WHERE id = 1;
