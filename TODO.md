# TODO

Implementation backlog for the club workflow that still needs to be completed and hardened.

How to use this list:
- Items are ordered so we can complete them one at a time without breaking later work.
- Each item should be finished end-to-end: Worker, frontend, validation, and report impact.
- Focus is on live Worker-backed behavior, not preview-only UI.

## 1. Loan Repayment Metadata And Schedule Consistency

- Verify all existing loans render correctly after the repayment metadata backfill.
- Audit exception loans where `repayment_plan`, `loan_repayments`, and `loan_charges` still do not align.
- Normalize legacy repayment-plan rows where needed so schedule months, statuses, and balances match real business history.
- Confirm completed loans no longer show misleading pending or late installments.
- Confirm first-installment charges appear on the right repayment month.

## 2. Admin Savings Workflow Hardening

- Re-test single savings entry for members and confirm each save reaches D1 correctly.
- Re-test batch savings entry and confirm it records immediately instead of showing misleading queue behavior.
- Add duplicate-period protection so the same member cannot be posted twice for the same month by mistake.
- Add backdated savings entry support where needed for historical data entry.
- Confirm savings entries refresh all dependent totals and member views.

## 3. Admin Loan Approval And Repayment Posting QA

- Re-test admin loan approval flow against real member applications.
- Confirm approved loans get the correct submitted date, approved date, repayment start month, and repayment plan.
- Re-test single repayment posting and payroll-style batch posting.
- Confirm principal, interest, outstanding balance, and installment status all update correctly after repayment.
- Re-test loan charge creation and confirm charges affect the correct first installment only where intended.

## 4. Early Repayment Workflow

- Implement Worker routes for early repayment requests end-to-end.
- Let members request early repayment from their loan detail view.
- Let members cancel an early repayment request while still pending.
- Add an admin early-repayment review queue.
- Let admin approve, reject, and mark approved requests as paid.
- When marked paid, convert the approved request into authoritative repayment records that update the real loan schedule.
- Show clear early repayment history to both member and admin.

## 5. Member Savings Experience

- Re-check member savings page against real data after admin backdated entries.
- Confirm month, amount, and recorded dates are accurate.
- Confirm export output matches live Worker data.
- Consider showing savings trend, current month status, and annual totals more clearly if needed.

## 6. Member Loan Application Rules

- Change short-term loan duration input from a free numeric field to a dropdown.
- For now, the dropdown should only allow up to `6 months` and should default safely.
- Keep short-term applications only.
- Keep purpose hidden for short-term applications.
- Preserve backdated application date support for historical entry while dev setup is active.
- Confirm available credit, eligibility, and limits are enforced correctly before submit.

## 7. Member Loan Detail Accuracy

- Confirm members can see full repayment schedule, recorded repayments, attached loan charges, and early-payment records correctly for every loan.
- Ensure schedule status reflects actual repayment rows rather than only inferred loan balance.
- Show rate, duration, submitted date, and approved date accurately from stored loan data.
- Re-check overdue and next-due KPIs after loan metadata fixes.

## 8. Interest And Monthly Close Engine

- Design and implement the monthly interest-close workflow.
- Separate trust interest from loan interest.
- Support retained earnings percentage for trust interest.
- Support retained earnings percentage for loan interest.
- Support configurable retained percentages such as `20%`, `30%`, or any allowed value.(These percentages to be configured in settings)
- And when the admin distributes interest, then members can see the interest they earned.
- But for unit trust interest even if the admin might distribute anytime they want, it is monthly that is if we say 30% is retained, then for the trust interest earned per month the 70% will be distributed among member depending on how they saved. 
- Compute distributable trust-interest pool after retention.
- Compute distributable loan-interest pool after retention.
- Post final month-close results into authoritative tables rather than report-only transforms.

## 9. Interest Distribution Rules

- Distribute trust interest based on each member's savings share for the month.
- Distribute loan interest equally according to the agreed club rule.
- Define which members are eligible for equal loan-interest sharing and make that rule explicit in code.
- Write member-level allocation records to `interest_allocations`.
- Let admin preview a month’s allocations before posting them.
- Let admin post finalized allocations and keep an audit trail.

## 10. Member Interest Visibility

- Let members see their interest earned in detail, not just aggregate monthly figures.
- Show the source split if possible:
  trust interest, loan interest, retained amount, and final distributed amount.
- Add a member-facing interest history page or report section backed by real allocation records.
- Allow CSV/PDF export of member interest distribution details.

## 11. Retained Earnings Management

- Replace report-only retained-earnings display with real operational management.
- Let admin define retention percentages by source where required.
- Show retained totals for trust interest and loan interest separately.
- Store retained values in a way that supports monthly close, annual summaries, and AGM reporting.
- Ensure retained earnings are reflected in final distributable balances.

## 12. Trust, Savings, Bank, And Withdrawal Flow

- Model the rule that member savings flow into the trust.
- Clarify and implement the money path for withdrawals:
  trust -> bank account -> member account.
- Record trust deposits, withdrawals, and interest with enough metadata for reconciliation.
- Decide whether bank charges and transfer costs should be tracked in trust flow, expenses, or both.
- Make sure reports can explain where money moved, not just final balances.

## 13. AGM Report Redesign

- Expand the AGM report beyond summary KPIs.
- Include savings totals, active members, trust movement, loan portfolio, outstanding loans, subscriptions, expenses, total interest earned, retained earnings, and distributed earnings.
- Include trust-interest and loan-interest breakdowns separately.
- Include member allocation summaries where appropriate.
- Include year or period filtering so AGM output matches the meeting period being reported.
- Make the AGM report suitable for real presentation/export, not just a lightweight dashboard summary.

## 14. Admin Reports And Financial Reporting

- Rework reports so they reflect posted accounting events, not only UI-level aggregates.
- Add richer trust movement reporting using trust statements and bank statement reconciliation where needed.
- Add reports for:
  interest allocations, retained earnings by source, withdrawal activity, and reconciliation summaries.
- Ensure all exports come from consistent Worker-backed datasets.

## 15. Reconciliation Inputs

- Review and map [bankstatement.pdf](C:/Users/kakun/Downloads/bankstatement.pdf:1) into the trust/bank flow.
- Review and map [truststatement.xlsx](C:/Users/kakun/OneDrive/Desktop/truststatement.xlsx:1) into the trust reporting flow.
- Use both sources to design reconciliation-friendly data structures and reports.

## 16. Final QA And Operational Readiness

- Re-test admin savings, admin loans, member savings, member loans, early repayments, reports, and month-close flows together.
- Verify all critical dates, money amounts, balances, retained values, and distributions are consistent across admin and member views.
- Confirm email/password dev access remains usable until Google-only production sign-in is enabled.
- Confirm production switch plan:
  `EMAIL_PASSWORD_SIGNIN_ENABLED=false` and Google OAuth only.
