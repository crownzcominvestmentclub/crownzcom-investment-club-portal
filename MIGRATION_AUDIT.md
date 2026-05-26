# Appwrite → Cloudflare D1 Migration Audit

## Goal
Audit Appwrite collection schemas from `backups/appwrite-2026-04-18` and compare them to the current Cloudflare D1 schema in `worker/migrations/0001_init.sql`.

## Findings

### Existing D1 schemas match APpwrite collections
The current D1 schema already covers these Appwrite collections and their primary domain concepts:
- `members` → `members`
- `savings` → `savings`
- `subscriptions` → `subscriptions`
- `loans` → `loans`
- `loan_guarantors` → `loan_guarantors`
- `loan_charges` → `loan_charges`
- `loan_repayments` → `loan_repayments`
- `early_repayment_requests` → `early_repayment_requests`
- `expenses` → `expenses`
- `unit_trust` → `unit_trust`
- `document_categories` → `document_categories`
- `documents` → `documents`
- `ledger_entries` → `ledger`
- `interest_monthly` → `interest_monthly`
- `retained_earnings` → `retained_earnings`
- `financial_config` → `financial_config`

### Key schema mismatches / gaps

#### 1. `members`
Appwrite fields:
- `membershipNumber`
- `authUserId`
- `joinDate`
- `status`
- `name`, `email`, `phone`

D1 members fields:
- `full_name`, `email`, `phone`, `status`, `joined_at`, `notes`

Needed mapping:
- `name` → `full_name`
- `joinDate` → `joined_at` (timestamp)
- `membershipNumber` currently has no dedicated column in D1
- `authUserId` currently has no D1 target beyond `auth_users.member_id`

Recommendation:
- Add `membership_number TEXT UNIQUE` to `members`
- Add `auth_user_id TEXT UNIQUE` to `members` or map Appwrite auth users separately into `auth_users`

#### 2. `savings`
Appwrite fields:
- `memberId`, `amount`, `month`, `createdAt`, `status`

D1 fields:
- `member_id`, `period_month`, `period_year`, `amount`, `status`, `paid_at`, `created_at`

Needed mapping:
- parse Appwrite `month` strings into `period_month` / `period_year`
- store `createdAt` as integer timestamp

#### 3. `subscriptions`
Appwrite fields:
- `memberId`, `amount`, `month`, `createdAt`

D1 fields:
- `member_id`, `period_year`, `amount`, `status`, `paid_at`, `created_at`

Needed mapping:
- parse `month` into `period_year` and maybe `status`
- Appwrite does not expose a native `status` field in the backup schema, but D1 requires one

#### 4. `loans`
Appwrite fields include:
- `memberId`, `amount`, `duration`, `selectedMonths`, `loanType`, `termsAccepted`, `purpose`, `repaymentType`, `repaymentPlan`, `status`, `createdAt`, `approvedAt`, `rejectedAt`, `balance`, `guarantorRequired`, `borrowerCoverage`

D1 fields are narrower:
- `member_id`, `type`, `principal`, `interest_rate_pct`, `term_months`, `purpose`, `status`, `outstanding`, `applied_at`, `approved_at`, `approved_by`, `rejected_reason`, `due_at`

Gaps:
- `selectedMonths`, `repaymentType`, `repaymentPlan` not stored
- `balance` maps to `outstanding`
- `guarantorRequired` not stored explicitly, although can infer from guarantor records
- `borrowerCoverage` not stored
- `termsAccepted` not stored

Recommendation:
- If these fields are important, extend `loans` with optional columns for `repayment_type`, `repayment_plan`, `terms_accepted`, `borrower_coverage`

#### 5. `loan_early_repayment_requests`
Appwrite fields are more detailed than current D1:
- `loanId`, `memberId`, `status`, `month`, `amount`, `interestCalculationModeApplied`, `monthlyInterestRateApplied`, `penaltyRateApplied`, `interestAmount`, `principalAmount`, `chargeAmount`, `balanceAtRequest`, `requestedAt`, `requestedForDate`, `resolvedAt`, `paidAt`, `adminComment`

D1 table only has:
- `loan_id`, `member_id`, `amount`, `status`, `requested_at`, `resolved_at`

Recommendation:
- Extend `early_repayment_requests` if the extra financial metadata is needed for reports or historical accuracy

#### 6. `ledger_entries`
Appwrite fields are generic:
- `type`, `amount`, `memberId`, `loanId`, `month`, `year`, `notes`

D1 ledger fields are more explicit:
- `occurred_at`, `account`, `direction`, `amount`, `ref_type`, `ref_id`, `memo`

Recommendation:
- Map Appwrite `type` → ledger `account`
- Map `notes` → `memo`
- Create `occurred_at` values from `month`/`year` or `createdAt`
- Derive `direction` from `type` semantics if possible

#### 7. `unit_trust`
Appwrite has:
- `type`, `amount`, `description`, `date`, `amountFloat`

D1 has:
- `kind`, `amount`, `note`, `occurred_at`, `created_at`

Recommendation:
- map `type` → `kind`
- map `description` → `note`
- preserve `amountFloat` in a new optional `amount_float` column if fractional values matter

#### 8. `documents`
Appwrite metadata includes:
- `title`, `category`, `fileId`, `bucketId`, `uploadedBy`, `uploadedAt`, `tags`, `period`, `notes`

D1 uses R2-backed metadata:
- `title`, `category_id`, `object_key`, `content_type`, `size_bytes`, `uploaded_at`, `uploaded_by`

Recommendation:
- Map Appwrite `fileId` and `bucketId` into an R2 `object_key`
- Preserve `tags`/`period`/`notes` in new columns if needed

#### 9. `document_categories`
- D1 `document_categories` is compatible and sufficient for Appwrite metadata.

#### 10. `interest_allocations`
Appwrite has a separate `interest_allocations` collection.
- Current D1 schema does not include this table.
- The Appwrite backup shows 0 documents, but the collection exists.

Recommendation:
- add a new `interest_allocations` table if Appwrite data or future logic depends on it

#### 11. `financial_config`
Appwrite fields do not align directly with D1 schema.
- Appwrite uses `loanInterestRate`, `longTermInterestRate`, `loanEligibilityPercentage`, `defaultBankCharge`, `earlyRepaymentPenalty`, `maxLoanDuration`, `longTermMaxRepaymentMonths`, `minLoanAmount`, `maxLoanAmount`, `interestCalculationMode`, `logoFileId`, `logoBucketId`
- D1 schema uses `monthly_contribution`, `short_term_rate_pct`, `long_term_rate_pct`, `loan_eligibility_pct`, `late_penalty_pct`, and `updated_at`

Recommendation:
- Add the missing Appwrite config fields to `financial_config`, or create a translation layer that stores Appwrite values in the existing D1 options

## Summary
The current D1 schema is a strong base and covers most Appwrite entities.
However, the following changes are recommended before migrating the backup data:

1. Add missing `members` metadata columns: `membership_number`, `auth_user_id`
2. Add or update `loans` columns for Appwrite-specific loan fields
3. Extend `early_repayment_requests` to store Appwrite request metadata
4. Add `interest_allocations` if full historical data migration is required
5. Add new columns for `documents` metadata if Appwrite `tags`, `period`, or `notes` must be preserved
6. Align `financial_config` with Appwrite field names and values

## Next Task
Proceed with Task 2: design the D1 schema and create SQL migrations for any missing columns or tables.
