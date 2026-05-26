PRAGMA foreign_keys=OFF;

ALTER TABLE early_repayment_requests RENAME TO early_repayment_requests_old;

CREATE TABLE early_repayment_requests (
  id                        TEXT PRIMARY KEY,
  loan_id                   TEXT NOT NULL REFERENCES loans(id) ON DELETE CASCADE,
  member_id                 TEXT NOT NULL REFERENCES members(id) ON DELETE CASCADE,
  amount                    INTEGER NOT NULL,
  status                    TEXT NOT NULL CHECK (status IN ('pending','approved','rejected','paid','cancelled')),
  requested_at              INTEGER NOT NULL,
  resolved_at               INTEGER,
  interest_calculation_mode TEXT,
  monthly_interest_rate     REAL,
  penalty_rate              REAL,
  interest_amount           INTEGER,
  principal_amount          INTEGER,
  charge_amount             INTEGER,
  balance_at_request        INTEGER,
  requested_for_date        INTEGER,
  paid_at                   INTEGER,
  admin_comment             TEXT
);

INSERT INTO early_repayment_requests (
  id,
  loan_id,
  member_id,
  amount,
  status,
  requested_at,
  resolved_at,
  interest_calculation_mode,
  monthly_interest_rate,
  penalty_rate,
  interest_amount,
  principal_amount,
  charge_amount,
  balance_at_request,
  requested_for_date,
  paid_at,
  admin_comment
)
SELECT
  id,
  loan_id,
  member_id,
  amount,
  status,
  requested_at,
  resolved_at,
  interest_calculation_mode,
  monthly_interest_rate,
  penalty_rate,
  interest_amount,
  principal_amount,
  charge_amount,
  balance_at_request,
  requested_for_date,
  paid_at,
  admin_comment
FROM early_repayment_requests_old;

DROP TABLE early_repayment_requests_old;

PRAGMA foreign_keys=ON;
