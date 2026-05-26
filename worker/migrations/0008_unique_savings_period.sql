CREATE UNIQUE INDEX IF NOT EXISTS idx_savings_member_period
ON savings(member_id, period_year, period_month);
