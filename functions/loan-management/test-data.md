# Sample JSON Test Data for Loan Management Functions

## 1. Approve Loan
```json
{
  "action": "approveLoan",
  "loanId": "loan123"
}
```

## 2. Reject Loan
```json
{
  "action": "rejectLoan",
  "loanId": "loan123"
}
```

## 3. Add Bank Charge
```json
{
  "action": "addLoanCharge",
  "loanId": "loan123",
  "description": "Bank processing fee",
  "amount": 50000
}
```

## 4. Update Bank Charge
```json
{
  "action": "updateLoanCharge",
  "chargeId": "charge123",
  "description": "Updated bank processing fee",
  "amount": 75000
}
```

## 5. Record Repayment
```json
{
  "action": "recordRepayment",
  "loanId": "loan123",
  "amount": 500000,
  "month": 1
}
```

## 6. Validate Loan Application
```json
{
  "action": "validateLoanApplication",
  "loanId": "loan123"
}
```

## Sample Test Data Setup

### Member Data
```json
{
  "name": "John Doe",
  "email": "john@example.com",
  "phone": "+256700123456",
  "membershipNumber": "MEM001",
  "joinDate": "2024-01-01T00:00:00.000Z",
  "status": "active"
}
```

### Savings Data (for member eligibility)
```json
[
  {
    "memberId": "member123",
    "amount": 1000000,
    "month": "2024-01",
    "createdAt": "2024-01-15T00:00:00.000Z"
  },
  {
    "memberId": "member123",
    "amount": 1000000,
    "month": "2024-02",
    "createdAt": "2024-02-15T00:00:00.000Z"
  },
  {
    "memberId": "member123",
    "amount": 1000000,
    "month": "2024-03",
    "createdAt": "2024-03-15T00:00:00.000Z"
  }
]
```

### Loan Application Data
```json
{
  "memberId": "member123",
  "amount": 2000000,
  "duration": 3,
  "purpose": "Business expansion",
  "repaymentType": "equal",
  "repaymentPlan": "[{\"month\":1,\"amount\":700000},{\"month\":2,\"amount\":700000},{\"month\":3,\"amount\":700000}]",
  "status": "pending",
  "createdAt": "2024-03-20T00:00:00.000Z"
}
```

## Test Scenarios

### Scenario 1: Successful Loan Approval
1. Member has 3,000,000 UGX total savings
2. Loan request: 2,000,000 UGX (66.7% of savings - eligible)
3. Expected: Loan approved and activated

### Scenario 2: Loan Rejection - Insufficient Savings
1. Member has 1,000,000 UGX total savings
2. Loan request: 1,500,000 UGX (150% of savings - not eligible)
3. Expected: Error "Loan amount exceeds 80% of member savings"

### Scenario 3: Add Bank Charges
1. Loan is approved/active
2. Add processing fee: 50,000 UGX
3. Expected: Charge added successfully

### Scenario 4: Record Repayment
1. Active loan with balance: 2,000,000 UGX
2. Payment: 700,000 UGX for month 1
3. Expected: New balance 1,300,000 UGX, status remains "active"

### Scenario 5: Complete Loan Repayment
1. Active loan with balance: 700,000 UGX
2. Final payment: 700,000 UGX for month 3
3. Expected: Balance 0 UGX, status changed to "completed"

## Environment Variables Required
```
APPWRITE_FUNCTION_ENDPOINT=https://cloud.appwrite.io/v1
APPWRITE_FUNCTION_PROJECT_ID=your-project-id
APPWRITE_API_KEY=your-server-api-key
DATABASE_ID=your-database-id
LOANS_COLLECTION_ID=697c9171001b85d570c2
LOAN_CHARGES_COLLECTION_ID=697c9325000805274ae4
LOAN_REPAYMENTS_COLLECTION_ID=697c929c003aedc62d7f
SAVINGS_COLLECTION_ID=697c904800100bb6d8ac
```

## Testing with Postman/curl

### Example curl command:
```bash
curl -X POST \
  https://cloud.appwrite.io/v1/functions/loan-management/executions \
  -H 'Content-Type: application/json' \
  -H 'X-Appwrite-Project: your-project-id' \
  -H 'Authorization: Bearer your-api-key' \
  -d '{
    "action": "approveLoan",
    "loanId": "loan123"
  }'
```