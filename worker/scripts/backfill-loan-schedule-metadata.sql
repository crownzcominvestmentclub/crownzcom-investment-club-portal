-- Backfill legacy loan schedule metadata so the frontend can correctly
-- reconcile loans.repayment_plan with loan_repayments and loan_charges.
--
-- Safe assumptions used here:
-- - repayment day defaults to the club standard day 4 when missing
-- - repayment_start_month is derived from the earliest repayment month if the
--   loan already has repayments, otherwise from the month after applied_at
-- - legacy repayment rows are assigned to installment months in paid_at order
-- - loan charges apply to the first installment month when missing

PRAGMA foreign_keys = ON;

-- 1. Default repayment day where it was never saved.
UPDATE loans
SET repayment_day_of_month = 4
WHERE repayment_day_of_month IS NULL;

-- 2. Derive repayment start month.
UPDATE loans
SET repayment_start_month = COALESCE(
  (
    SELECT strftime('%Y-%m', MIN(datetime(r.paid_at / 1000, 'unixepoch')))
    FROM loan_repayments r
    WHERE r.loan_id = loans.id
  ),
  strftime('%Y-%m', datetime(loans.applied_at / 1000, 'unixepoch', 'start of month', '+1 month'))
)
WHERE repayment_start_month IS NULL OR trim(repayment_start_month) = '';

-- 3. Fill first repayment date from the derived schedule month + day of month.
UPDATE loans
SET first_repayment_date = (
  strftime(
    '%s',
    repayment_start_month || '-' || printf('%02d', COALESCE(repayment_day_of_month, 4)) || ' 00:00:00'
  ) * 1000
)
WHERE first_repayment_date IS NULL
  AND repayment_start_month IS NOT NULL
  AND trim(repayment_start_month) <> '';

-- 4. Backfill repayment month values in chronological order per loan.
WITH ranked AS (
  SELECT
    r.id AS repayment_id,
    l.repayment_start_month AS start_month,
    ROW_NUMBER() OVER (
      PARTITION BY r.loan_id
      ORDER BY r.paid_at ASC, r.id ASC
    ) - 1 AS installment_offset
  FROM loan_repayments r
  JOIN loans l ON l.id = r.loan_id
  WHERE r.month IS NULL OR trim(r.month) = ''
)
UPDATE loan_repayments
SET month = (
  SELECT strftime(
    '%Y-%m',
    date(start_month || '-01', '+' || installment_offset || ' month')
  )
  FROM ranked
  WHERE ranked.repayment_id = loan_repayments.id
)
WHERE id IN (SELECT repayment_id FROM ranked);

-- 5. Charges without an explicit month belong to the first installment month.
UPDATE loan_charges
SET applies_to_month = (
  SELECT l.repayment_start_month
  FROM loans l
  WHERE l.id = loan_charges.loan_id
)
WHERE applies_to_month IS NULL OR trim(applies_to_month) = '';

-- 6. Return a quick verification snapshot.
SELECT
  (SELECT COUNT(*) FROM loans) AS loan_count,
  (SELECT COUNT(*) FROM loans WHERE repayment_start_month IS NULL OR trim(repayment_start_month) = '') AS loans_missing_start_month,
  (SELECT COUNT(*) FROM loan_repayments) AS repayment_count,
  (SELECT COUNT(*) FROM loan_repayments WHERE month IS NULL OR trim(month) = '') AS repayments_missing_month,
  (SELECT COUNT(*) FROM loan_charges) AS charge_count,
  (SELECT COUNT(*) FROM loan_charges WHERE applies_to_month IS NULL OR trim(applies_to_month) = '') AS charges_missing_month;
