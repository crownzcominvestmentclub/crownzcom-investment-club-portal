-- Add month, early payment flag, and payment status to loan repayments.

PRAGMA foreign_keys = ON;

ALTER TABLE loan_repayments ADD COLUMN month TEXT CHECK(month IS NULL OR month GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]');
ALTER TABLE loan_repayments ADD COLUMN is_early_payment INTEGER NOT NULL DEFAULT 0 CHECK(is_early_payment IN (0,1));
ALTER TABLE loan_repayments ADD COLUMN payment_status TEXT NOT NULL DEFAULT 'paid' CHECK(payment_status IN ('pending','paid','late','early'));