# Loan Repayments API

This document covers the current repayment and charge endpoints for the loans module.

## Repayment Status Rules

Statuses are derived from the scheduled `month` (`YYYY-MM`) and the actual `paidAt` timestamp.

- `pending`: no payment recorded yet and the scheduled month has not ended.
- `late`: no payment recorded and the scheduled month has ended, or a payment was recorded after the month ended.
- `paid`: payment was recorded within the scheduled month.
- `early`: payment was recorded before the scheduled month started.

If the client sends `paymentStatus`, the Worker validates it against the server-calculated status and rejects mismatches.

## Single Repayment

`POST /api/loans/:id/repayments`

Payload:

```json
{
  "month": "2026-05",
  "amount": 125000,
  "paidAt": 1777593600000,
  "isEarlyPayment": false,
  "paymentStatus": "paid"
}
```

Behavior:

- validates the scheduled month exists on the loan repayment plan
- blocks duplicate repayment months per loan
- blocks amounts above the scheduled amount
- calculates principal and interest portions
- updates loan outstanding balance
- writes cash, receivable, and interest ledger entries

## Batch Repayments

`POST /api/loans/repayments/batch`

Payload:

```json
{
  "entries": [
    {
      "loanId": "loan_123",
      "month": "2026-05",
      "amount": 125000,
      "paidAt": 1777593600000,
      "isEarlyPayment": false,
      "paymentStatus": "paid"
    },
    {
      "loanId": "loan_456",
      "month": "2026-05",
      "amount": 98000,
      "paidAt": 1777593600000,
      "isEarlyPayment": false,
      "paymentStatus": "paid"
    }
  ]
}
```

Behavior:

- validates each entry against that loan's schedule before posting
- applies the same status logic as single repayments
- updates outstanding balances sequentially inside the batch
- writes the same ledger set as single repayments

Current validation errors include:

- `invalid_loan_status`
- `schedule_month_not_found`
- `schedule_month_already_paid`
- `repayment_exceeds_scheduled_amount`
- `repayment_status_mismatch`

## Loan Charges

### List all charges

`GET /api/loans/charges`

### List charges for one loan

`GET /api/loans/:id/charges`

### Add charge

`POST /api/loans/:id/charges`

Payload:

```json
{
  "kind": "processing_fee",
  "amount": 5000,
  "note": "First-month bank charge",
  "appliesToMonth": "2026-05"
}
```

Notes:

- `appliesToMonth` is optional
- omitting `appliesToMonth` creates a general charge not tied to a scheduled month
- setting `appliesToMonth` to the first scheduled month supports first-month charge grouping without making it mandatory for all loans

### Remove charge

`DELETE /api/loans/charges/:chargeId`

## Frontend Validation Notes

The admin UI now performs lightweight pre-submit checks before calling the Worker:

- single repayment amount must be positive
- single repayment amount cannot exceed the selected scheduled amount
- batch posting requires at least one selected row
- batch posting requires a valid amount on every selected row
- charge creation requires a positive amount
- custom charge month selection requires a `YYYY-MM` value

The Worker remains the source of truth for all financial validations.
