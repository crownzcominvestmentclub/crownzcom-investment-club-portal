## Example Payloads

### Approve request

```json
{
  "action": "respondGuarantorRequest",
  "requestId": "LOAN_GUARANTOR_REQUEST_ID",
  "response": "approve",
  "comment": "I accept this guarantee request."
}
```

### Decline request

```json
{
  "action": "respondGuarantorRequest",
  "requestId": "LOAN_GUARANTOR_REQUEST_ID",
  "response": "decline",
  "comment": "I cannot guarantee this amount right now."
}
```
