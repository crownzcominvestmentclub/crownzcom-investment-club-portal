ALTER TABLE loans
ADD COLUMN interest_calculation_mode_applied TEXT
  CHECK (
    interest_calculation_mode_applied IS NULL
    OR interest_calculation_mode_applied IN ('flat', 'reducing_balance')
  );

UPDATE loans
SET interest_calculation_mode_applied = (
  SELECT COALESCE(interest_calculation_mode, 'flat')
  FROM financial_config
  WHERE id = 1
)
WHERE interest_calculation_mode_applied IS NULL
  AND status IN ('pending', 'guarantors_pending', 'approved');
