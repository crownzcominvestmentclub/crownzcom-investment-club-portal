// Service layer — frontend data access abstraction.
//
// Backend: Cloudflare Workers + D1 (database) + R2 (object storage).
// All UI calls these services (or hooks in @/hooks/data) so the Worker API
// can be swapped or extended without touching components.
//
// Behaviour:
//   - When VITE_API_BASE_URL is set, calls hit the Cloudflare Worker.
//   - Otherwise, reads return rich seed data and writes throw a clear
//     "configure VITE_API_BASE_URL" error. This keeps the UI demoable
//     without a live Worker.
//
// Server-authoritative endpoints (must run in the Worker against D1):
//   POST   /api/loans/validate
//   POST   /api/loans                       (submit long-term loan)
//   POST   /api/loans/:id/final-approve
//   POST   /api/loans/:id/reject
//   POST   /api/loans/:id/repayments        (allocates borrower vs guarantor)
//   POST   /api/guarantor-requests/:id/respond
//   POST   /api/savings/batch               (writes ledger entries)

import { api, isApiConfigured } from "@/lib/api";
import {
  seedAuthUsers,
  seedDocumentCategories,
  seedDocuments,
  seedEarlyRepaymentRequests,
  seedExpenses,
  seedFinancialConfig,
  seedInterestMonthly,
  seedLedger,
  seedLoanCharges,
  seedLoanGuarantors,
  seedLoanRepayments,
  seedLoans,
  seedMembers,
  seedRetainedEarnings,
  seedSavings,
  seedSubscriptions,
  seedUnitTrust,
} from "@/data/seed";
import type {
  AuthUser,
  DocumentCategory,
  DocumentRecord,
  Expense,
  FinancialConfig,
  InterestMonthly,
  LedgerEntry,
  Loan,
  LoanCharge,
  LoanEarlyRepaymentRequest,
  LoanGuarantor,
  LoanRepayment,
  Member,
  RetainedEarnings,
  Savings,
  Subscription,
  UnitTrust,
  ID,
} from "@/lib/types";

// Simulated network latency for realistic loading states when using seeds
const delay = <T,>(value: T, ms = 200): Promise<T> =>
  new Promise((resolve) => setTimeout(() => resolve(value), ms));

const notWired = (op: string) =>
  Promise.reject(
    new Error(
      `${op} requires the Cloudflare Worker. Set VITE_API_BASE_URL and implement the corresponding route.`
    )
  );

// ---------- Auth ----------
export const authService = {
  list: () => (isApiConfigured() ? api.get<AuthUser[]>("/api/auth/users") : delay(seedAuthUsers)),
  findByEmail: (email: string) =>
    isApiConfigured()
      ? api.get<AuthUser | null>("/api/auth/lookup", { email })
      : delay(seedAuthUsers.find((u) => u.email.toLowerCase() === email.toLowerCase()) ?? null),
  signInWithEmail: (email: string, password: string) =>
    isApiConfigured()
      ? api.post<AuthUser>("/api/auth/sign-in", { email, password })
      : notWired("auth.signInWithEmail"),
  signOut: () => (isApiConfigured() ? api.post<void>("/api/auth/sign-out") : Promise.resolve()),
};

// ---------- Members ----------
export const membersService = {
  list: () => (isApiConfigured() ? api.get<Member[]>("/api/members") : delay(seedMembers)),
  get: (id: ID) =>
    isApiConfigured()
      ? api.get<Member | null>(`/api/members/${id}`)
      : delay(seedMembers.find((m) => m.id === id) ?? null),
  create: (input: Omit<Member, "id">) =>
    isApiConfigured() ? api.post<Member>("/api/members", input) : notWired("members.create"),
  update: (id: ID, patch: Partial<Member>) =>
    isApiConfigured() ? api.patch<Member>(`/api/members/${id}`, patch) : notWired("members.update"),
  remove: (id: ID) =>
    isApiConfigured() ? api.delete<void>(`/api/members/${id}`) : notWired("members.remove"),
};

// ---------- Savings ----------
export const savingsService = {
  list: () => (isApiConfigured() ? api.get<Savings[]>("/api/savings") : delay(seedSavings)),
  byMember: (memberId: ID) =>
    isApiConfigured()
      ? api.get<Savings[]>(`/api/members/${memberId}/savings`)
      : delay(seedSavings.filter((s) => s.memberId === memberId)),
  totalByMember: (memberId: ID) =>
    isApiConfigured()
      ? api.get<number>(`/api/members/${memberId}/savings/total`)
      : delay(seedSavings.filter((s) => s.memberId === memberId).reduce((a, s) => a + s.amount, 0)),
  totalAll: () =>
    isApiConfigured()
      ? api.get<number>("/api/savings/total")
      : delay(seedSavings.reduce((a, s) => a + s.amount, 0)),
  add: (input: Omit<Savings, "id" | "createdAt">) =>
    isApiConfigured() ? api.post<Savings>("/api/savings", input) : notWired("savings.add"),
  // Server-authoritative: writes ledger entries in the same D1 transaction
  batchAdd: (inputs: Array<Omit<Savings, "id" | "createdAt">>) =>
    isApiConfigured() ? api.post<Savings[]>("/api/savings/batch", { entries: inputs }) : notWired("savings.batchAdd"),
};

// ---------- Loans ----------
export const loansService = {
  list: () => (isApiConfigured() ? api.get<Loan[]>("/api/loans") : delay(seedLoans)),
  byMember: (memberId: ID) =>
    isApiConfigured()
      ? api.get<Loan[]>(`/api/members/${memberId}/loans`)
      : delay(seedLoans.filter((l) => l.memberId === memberId)),
  get: (id: ID) =>
    isApiConfigured()
      ? api.get<Loan | null>(`/api/loans/${id}`)
      : delay(seedLoans.find((l) => l.id === id) ?? null),
  validate: (input: unknown) =>
    isApiConfigured() ? api.post<{ ok: boolean; reasons?: string[] }>("/api/loans/validate", input) : notWired("loans.validate"),
  submitLongTerm: (input: unknown) =>
    isApiConfigured() ? api.post<Loan>("/api/loans", input) : notWired("loans.submitLongTerm"),
  finalApprove: (loanId: ID) =>
    isApiConfigured() ? api.post<Loan>(`/api/loans/${loanId}/final-approve`) : notWired("loans.finalApprove"),
  reject: (loanId: ID, reason: string) =>
    isApiConfigured() ? api.post<Loan>(`/api/loans/${loanId}/reject`, { reason }) : notWired("loans.reject"),
  update: (id: ID, patch: Partial<Loan>) =>
    isApiConfigured() ? api.patch<Loan>(`/api/loans/${id}`, patch) : notWired("loans.update"),
  remove: (id: ID) =>
    isApiConfigured() ? api.delete<void>(`/api/loans/${id}`) : notWired("loans.remove"),
};

export const loanRepaymentsService = {
  list: () => (isApiConfigured() ? api.get<LoanRepayment[]>("/api/loan-repayments") : delay(seedLoanRepayments)),
  byLoan: (loanId: ID) =>
    isApiConfigured()
      ? api.get<LoanRepayment[]>(`/api/loans/${loanId}/repayments`)
      : delay(seedLoanRepayments.filter((r) => r.loanId === loanId)),
  // Server-authoritative: allocates between borrower & guarantor coverage
  record: (input: Omit<LoanRepayment, "id">) =>
    isApiConfigured()
      ? api.post<LoanRepayment>(`/api/loans/${input.loanId}/repayments`, input)
      : notWired("loanRepayments.record"),
};

export const loanChargesService = {
  list: () => (isApiConfigured() ? api.get<LoanCharge[]>("/api/loan-charges") : delay(seedLoanCharges)),
  byLoan: (loanId: ID) =>
    isApiConfigured()
      ? api.get<LoanCharge[]>(`/api/loans/${loanId}/charges`)
      : delay(seedLoanCharges.filter((c) => c.loanId === loanId)),
  add: (input: Omit<LoanCharge, "id" | "createdAt">) =>
    isApiConfigured() ? api.post<LoanCharge>(`/api/loans/${input.loanId}/charges`, input) : notWired("loanCharges.add"),
  update: (id: ID, patch: Partial<LoanCharge>) =>
    isApiConfigured() ? api.patch<LoanCharge>(`/api/loan-charges/${id}`, patch) : notWired("loanCharges.update"),
  remove: (id: ID) =>
    isApiConfigured() ? api.delete<void>(`/api/loan-charges/${id}`) : notWired("loanCharges.remove"),
};

export const loanGuarantorsService = {
  list: () => (isApiConfigured() ? api.get<LoanGuarantor[]>("/api/guarantor-requests") : delay(seedLoanGuarantors)),
  byLoan: (loanId: ID) =>
    isApiConfigured()
      ? api.get<LoanGuarantor[]>(`/api/loans/${loanId}/guarantors`)
      : delay(seedLoanGuarantors.filter((g) => g.loanId === loanId)),
  pendingForGuarantor: (memberId: ID) =>
    isApiConfigured()
      ? api.get<LoanGuarantor[]>(`/api/members/${memberId}/guarantor-requests`, { status: "pending" })
      : delay(seedLoanGuarantors.filter((g) => g.guarantorId === memberId && g.status === "pending")),
  byGuarantor: (memberId: ID) =>
    isApiConfigured()
      ? api.get<LoanGuarantor[]>(`/api/members/${memberId}/guarantor-requests`)
      : delay(seedLoanGuarantors.filter((g) => g.guarantorId === memberId)),
  // Server-authoritative: must verify caller identity = guarantor
  respond: (id: ID, decision: "approve" | "decline", comment?: string) =>
    isApiConfigured()
      ? api.post<LoanGuarantor>(`/api/guarantor-requests/${id}/respond`, { decision, comment })
      : notWired("loanGuarantors.respond"),
};

export const earlyRepaymentService = {
  list: () =>
    isApiConfigured() ? api.get<LoanEarlyRepaymentRequest[]>("/api/early-repayments") : delay(seedEarlyRepaymentRequests),
  byMember: (memberId: ID) =>
    isApiConfigured()
      ? api.get<LoanEarlyRepaymentRequest[]>(`/api/members/${memberId}/early-repayments`)
      : delay(seedEarlyRepaymentRequests.filter((r) => r.memberId === memberId)),
  request: (input: Omit<LoanEarlyRepaymentRequest, "id" | "requestedAt">) =>
    isApiConfigured() ? api.post<LoanEarlyRepaymentRequest>("/api/early-repayments", input) : notWired("earlyRepayment.request"),
  cancel: (id: ID) =>
    isApiConfigured() ? api.post<void>(`/api/early-repayments/${id}/cancel`) : notWired("earlyRepayment.cancel"),
  markPaid: (id: ID) =>
    isApiConfigured() ? api.post<void>(`/api/early-repayments/${id}/mark-paid`) : notWired("earlyRepayment.markPaid"),
};

// ---------- Subscriptions ----------
export const subscriptionsService = {
  list: () => (isApiConfigured() ? api.get<Subscription[]>("/api/subscriptions") : delay(seedSubscriptions)),
  byMember: (memberId: ID) =>
    isApiConfigured()
      ? api.get<Subscription[]>(`/api/members/${memberId}/subscriptions`)
      : delay(seedSubscriptions.filter((s) => s.memberId === memberId)),
  add: (input: Omit<Subscription, "id" | "createdAt">) =>
    isApiConfigured() ? api.post<Subscription>("/api/subscriptions", input) : notWired("subscriptions.add"),
};

// ---------- Expenses ----------
export const expensesService = {
  list: () => (isApiConfigured() ? api.get<Expense[]>("/api/expenses") : delay(seedExpenses)),
  add: (input: Omit<Expense, "id" | "createdAt">) =>
    isApiConfigured() ? api.post<Expense>("/api/expenses", input) : notWired("expenses.add"),
  update: (id: ID, patch: Partial<Expense>) =>
    isApiConfigured() ? api.patch<Expense>(`/api/expenses/${id}`, patch) : notWired("expenses.update"),
  remove: (id: ID) =>
    isApiConfigured() ? api.delete<void>(`/api/expenses/${id}`) : notWired("expenses.remove"),
};

// ---------- Unit Trust ----------
export const unitTrustService = {
  list: () => (isApiConfigured() ? api.get<UnitTrust[]>("/api/unit-trust") : delay(seedUnitTrust)),
  add: (input: Omit<UnitTrust, "id" | "createdAt">) =>
    isApiConfigured() ? api.post<UnitTrust>("/api/unit-trust", input) : notWired("unitTrust.add"),
};

// ---------- Documents (R2-backed) ----------
//
// Upload flow:
//   1. Client calls `uploadToR2(file)` → POST /api/uploads/sign → PUT to R2.
//   2. Client calls `documentsService.register({ ...meta, objectKey })` so the
//      Worker writes a row in D1 and links it to the R2 object.
export const documentsService = {
  list: () => (isApiConfigured() ? api.get<DocumentRecord[]>("/api/documents") : delay(seedDocuments)),
  categories: () =>
    isApiConfigured() ? api.get<DocumentCategory[]>("/api/document-categories") : delay(seedDocumentCategories),
  register: (input: Omit<DocumentRecord, "id" | "uploadedAt">) =>
    isApiConfigured() ? api.post<DocumentRecord>("/api/documents", input) : notWired("documents.register"),
  remove: (id: ID) =>
    isApiConfigured() ? api.delete<void>(`/api/documents/${id}`) : notWired("documents.remove"),
};

// ---------- Reports / Ledger ----------
export const reportsService = {
  ledger: () => (isApiConfigured() ? api.get<LedgerEntry[]>("/api/reports/ledger") : delay(seedLedger)),
  interestMonthly: () =>
    isApiConfigured() ? api.get<InterestMonthly[]>("/api/reports/interest-monthly") : delay(seedInterestMonthly),
  retainedEarnings: () =>
    isApiConfigured() ? api.get<RetainedEarnings[]>("/api/reports/retained-earnings") : delay(seedRetainedEarnings),
};

// ---------- Financial Config ----------
export const financialConfigService = {
  get: () => (isApiConfigured() ? api.get<FinancialConfig>("/api/financial-config") : delay(seedFinancialConfig)),
  update: (patch: Partial<FinancialConfig>) =>
    isApiConfigured() ? api.patch<FinancialConfig>("/api/financial-config", patch) : notWired("financialConfig.update"),
};
