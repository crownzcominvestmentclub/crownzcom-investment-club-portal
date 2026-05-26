## Example Payloads

### Long-term with guarantors

```json
{
  "action": "submitLongTermLoan",
  "memberId": "MEMBER_DOCUMENT_ID",
  "amount": 1200000,
  "loanType": "long_term",
  "selectedMonths": 12,
  "purpose": "Business expansion",
  "repaymentType": "equal",
  "termsAccepted": true,
  "guarantors": [
    {
      "guarantorId": "GUARANTOR_MEMBER_ID_1",
      "guaranteeType": "amount",
      "guaranteedAmount": 400000
    },
    {
      "guarantorId": "GUARANTOR_MEMBER_ID_2",
      "guaranteeType": "percent",
      "guaranteedPercent": 33.4
    }
  ]
}
```

### Long-term fully covered by borrower credit

```json
{
  "action": "submitLongTermLoan",
  "memberId": "MEMBER_DOCUMENT_ID",
  "amount": 300000,
  "loanType": "long_term",
  "selectedMonths": 8,
  "purpose": "School fees",
  "repaymentType": "equal",
  "termsAccepted": true
}
```
