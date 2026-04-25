// Service layer — frontend data access abstraction.
// All UI calls these functions (or the hooks in @/hooks/data) so the backend
// can be swapped to Convex queries/mutations without touching components.
//
// To wire Convex later:
//   - Replace each function body with `useQuery(api.xxx.yyy, args)` style adapters,
//     or expose Convex actions through this same API surface.
//   - Keep the function signatures identical to avoid component churn.

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

// Simulated network latency for realistic loading states
const delay = <T,>(value: T, ms = 200): Promise<T> =>
  new Promise((resolve) => setTimeout(() => resolve(value), ms));

// ---------- Auth ----------
export const authService = {
  list: () => delay(seedAuthUsers),
  findByEmail: (email: string) =>
    delay(seedAuthUsers.find((u) => u.email.toLowerCase() === email.toLowerCase()) ?? null),
};

// ---------- Members ----------
export const membersService = {
  list: () => delay(seedMembers),
  get: (id: ID) => delay(seedMembers.find((m) => m.id === id) ?? null),
  // Convex mutation placeholder
  create: async (_input: Omit<Member, "id">) => {
    throw new Error("create() — wire to Convex mutation `members.create`");
  },
  update: async (_id: ID, _patch: Partial<Member>) => {
    throw new Error("update() — wire to Convex mutation `members.update`");
  },
  remove: async (_id: ID) => {
    throw new Error("remove() — wire to Convex mutation `members.remove`");
  },
};

// ---------- Savings ----------
export const savingsService = {
  list: () => delay(seedSavings),
  byMember: (memberId: ID) => delay(seedSavings.filter((s) => s.memberId === memberId)),
  totalByMember: (memberId: ID) =>
    delay(seedSavings.filter((s) => s.memberId === memberId).reduce((a, s) => a + s.amount, 0)),
  totalAll: () => delay(seedSavings.reduce((a, s) => a + s.amount, 0)),
  add: async (_input: Omit<Savings, "id" | "createdAt">) => {
    throw new Error("add() — wire to Convex mutation `savings.add`");
  },
  batchAdd: async (_inputs: Array<Omit<Savings, "id" | "createdAt">>) => {
    // Server-authoritative: must run as Convex action (creates ledger entries too)
    throw new Error("batchAdd() — wire to Convex action `savings.batchAddSavings`");
  },
};

// ---------- Loans ----------
export const loansService = {
  list: () => delay(seedLoans),
  byMember: (memberId: ID) => delay(seedLoans.filter((l) => l.memberId === memberId)),
  get: (id: ID) => delay(seedLoans.find((l) => l.id === id) ?? null),
  // Server actions (Convex):
  validate: async (_input: unknown) => {
    throw new Error("validate() — Convex action `loans.validateLoanApplication`");
  },
  submitLongTerm: async (_input: unknown) => {
    throw new Error("submitLongTerm() — Convex action `loans.submitLongTermLoan`");
  },
  finalApprove: async (_loanId: ID) => {
    throw new Error("finalApprove() — Convex action `loans.finalApproveLoan`");
  },
  reject: async (_loanId: ID, _reason: string) => {
    throw new Error("reject() — Convex action `loans.rejectLoan`");
  },
  update: async (_id: ID, _patch: Partial<Loan>) => {
    throw new Error("update() — Convex action `loans.updateLoanDetails`");
  },
  remove: async (_id: ID) => {
    throw new Error("remove() — Convex action `loans.deleteLoan`");
  },
};

export const loanRepaymentsService = {
  list: () => delay(seedLoanRepayments),
  byLoan: (loanId: ID) => delay(seedLoanRepayments.filter((r) => r.loanId === loanId)),
  record: async (_input: Omit<LoanRepayment, "id">) => {
    // Server-authoritative: allocates between borrower & guarantor coverage
    throw new Error("record() — Convex action `loans.recordRepayment`");
  },
};

export const loanChargesService = {
  list: () => delay(seedLoanCharges),
  byLoan: (loanId: ID) => delay(seedLoanCharges.filter((c) => c.loanId === loanId)),
  add: async (_input: Omit<LoanCharge, "id" | "createdAt">) => {
    throw new Error("add() — Convex action `loans.addLoanCharge`");
  },
  update: async (_id: ID, _patch: Partial<LoanCharge>) => {
    throw new Error("update() — Convex action `loans.updateLoanCharge`");
  },
  remove: async (_id: ID) => {
    throw new Error("remove() — Convex action `loans.deleteLoanCharge`");
  },
};

export const loanGuarantorsService = {
  list: () => delay(seedLoanGuarantors),
  byLoan: (loanId: ID) => delay(seedLoanGuarantors.filter((g) => g.loanId === loanId)),
  pendingForGuarantor: (memberId: ID) =>
    delay(seedLoanGuarantors.filter((g) => g.guarantorId === memberId && g.status === "pending")),
  byGuarantor: (memberId: ID) =>
    delay(seedLoanGuarantors.filter((g) => g.guarantorId === memberId)),
  respond: async (_id: ID, _decision: "approve" | "decline", _comment?: string) => {
    throw new Error("respond() — Convex action `loans.respondGuarantorRequest`");
  },
};

export const earlyRepaymentService = {
  list: () => delay(seedEarlyRepaymentRequests),
  byMember: (memberId: ID) =>
    delay(seedEarlyRepaymentRequests.filter((r) => r.memberId === memberId)),
  request: async (_input: Omit<LoanEarlyRepaymentRequest, "id" | "requestedAt">) => {
    throw new Error("request() — Convex action `loans.requestEarlyRepayment`");
  },
  cancel: async (_id: ID) => {
    throw new Error("cancel() — Convex action `loans.cancelEarlyRepaymentRequest`");
  },
  markPaid: async (_id: ID) => {
    throw new Error("markPaid() — Convex action `loans.markEarlyRepaymentPaid`");
  },
};

// ---------- Subscriptions ----------
export const subscriptionsService = {
  list: () => delay(seedSubscriptions),
  byMember: (memberId: ID) => delay(seedSubscriptions.filter((s) => s.memberId === memberId)),
  add: async (_input: Omit<Subscription, "id" | "createdAt">) => {
    throw new Error("add() — wire to Convex mutation `subscriptions.add`");
  },
};

// ---------- Expenses ----------
export const expensesService = {
  list: () => delay(seedExpenses),
  add: async (_input: Omit<Expense, "id" | "createdAt">) => {
    throw new Error("add() — wire to Convex mutation `expenses.add`");
  },
  update: async (_id: ID, _patch: Partial<Expense>) => {
    throw new Error("update() — wire to Convex mutation `expenses.update`");
  },
  remove: async (_id: ID) => {
    throw new Error("remove() — wire to Convex mutation `expenses.remove`");
  },
};

// ---------- Unit Trust ----------
export const unitTrustService = {
  list: () => delay(seedUnitTrust),
  add: async (_input: Omit<UnitTrust, "id" | "createdAt">) => {
    throw new Error("add() — wire to Convex mutation `unitTrust.add`");
  },
};

// ---------- Documents ----------
export const documentsService = {
  list: () => delay(seedDocuments),
  categories: () => delay(seedDocumentCategories),
  upload: async (_input: Omit<DocumentRecord, "id" | "uploadedAt">) => {
    throw new Error("upload() — wire to Convex action `documents.upload`");
  },
  remove: async (_id: ID) => {
    throw new Error("remove() — wire to Convex mutation `documents.remove`");
  },
};

// ---------- Reports / Ledger ----------
export const reportsService = {
  ledger: () => delay(seedLedger),
  interestMonthly: () => delay(seedInterestMonthly),
  retainedEarnings: () => delay(seedRetainedEarnings),
};

// ---------- Financial Config ----------
export const financialConfigService = {
  get: () => delay(seedFinancialConfig),
  update: async (_patch: Partial<FinancialConfig>) => {
    throw new Error("update() — wire to Convex mutation `financialConfig.update`");
  },
};
