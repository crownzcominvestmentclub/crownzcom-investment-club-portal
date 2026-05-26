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
//   POST   /api/loans/repayments/batch      (validates schedule + posts payroll-style batches)
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
  seedInterestAllocations,
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
  DocumentScope,
  Expense,
  FinancialConfig,
  InterestAllocation,
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

function toIsoDate(raw: unknown): string | undefined {
  if (typeof raw === "number") return new Date(raw).toISOString();
  if (typeof raw === "string" && raw) return raw;
  return undefined;
}

function normalizeLoanStatus(rawStatus: string | undefined | null): LoanStatus {
  const status = String(rawStatus ?? "").trim().toLowerCase();
  if (status === "pending") return "pending_admin_approval";
  if (status === "guarantors_pending") return "pending_guarantor_approval";
  if (status === "approved") return "pending_admin_approval";
  if (status === "failed") return "guarantor_coverage_failed";
  if (status === "active") return "active";
  if (status === "completed") return "completed";
  if (status === "rejected") return "rejected";
  return "active";
}

function normalizeRepaymentPlanItem(input: any, index: number, fallbackStartMonth?: string) {
  const rawMonth = input?.month;
  let month = typeof rawMonth === "string" ? rawMonth : "";

  if (!/^\d{4}-\d{2}$/.test(month) && fallbackStartMonth) {
    const installmentOffset = Math.max(0, Number(rawMonth ?? index + 1) - 1);
    const [year, monthNum] = fallbackStartMonth.split("-").map(Number);
    month = new Date(Date.UTC(year, monthNum - 1 + installmentOffset, 1)).toISOString().slice(0, 7);
  }

  const principal = Number(input?.principal ?? 0) || 0;
  const interest = Number(input?.interest ?? 0) || 0;
  const chargeAmount = Number(input?.chargeAmount ?? 0) || 0;
  const baseTotal = Number(input?.baseTotal ?? input?.payment ?? input?.total ?? principal + interest) || 0;

  return {
    installmentNumber: Number(input?.installmentNumber ?? rawMonth ?? index + 1) || index + 1,
    month,
    dueDate: toIsoDate(input?.dueDate),
    principal,
    interest,
    chargeAmount,
    chargeId: input?.chargeId,
    chargeLabel: input?.chargeLabel,
    baseTotal,
    total: Number(input?.total ?? input?.payment ?? baseTotal + chargeAmount) || 0,
    balance: Number(input?.balance ?? input?.remainingBalance ?? 0) || 0,
    status: input?.status ?? "pending",
    paymentId: input?.paymentId,
    paidAt: toIsoDate(input?.paidAt),
  };
}

function deriveLoanDisplayBalance(
  amount: number,
  repaymentPlan: Array<{ balance: number; status: string }> | undefined,
  fallbackBalance: number,
) {
  if (!repaymentPlan || repaymentPlan.length === 0) return fallbackBalance;

  const settledStatuses = new Set(["paid", "early"]);
  const lastSettled = [...repaymentPlan].reverse().find((item) => settledStatuses.has(String(item.status ?? "").toLowerCase()));

  if (!lastSettled) return amount;
  return Number(lastSettled.balance ?? 0) || 0;
}

function normalizeLoan(input: any): Loan {
  const status = normalizeLoanStatus(input.status ?? input.statusRaw);
  const amount = Number(input.amount ?? input.principal ?? 0);
  const rawBalanceSource = input.balance ?? input.outstanding;
  const rawBalance = Number(rawBalanceSource ?? 0);
  const repaymentStartMonth = input.repaymentStartMonth ?? input.repayment_start_month;
  const rawRepaymentPlan =
    typeof input.repaymentPlan === "string"
      ? JSON.parse(input.repaymentPlan)
      : input.repaymentPlan;
  const repaymentPlan = Array.isArray(rawRepaymentPlan)
    ? rawRepaymentPlan.map((item: any, index: number) =>
        normalizeRepaymentPlanItem(item, index, repaymentStartMonth))
    : undefined;
  const balance =
    rawBalanceSource !== undefined && rawBalanceSource !== null && !Number.isNaN(rawBalance)
      ? rawBalance
      : deriveLoanDisplayBalance(
          Number.isNaN(amount) ? 0 : amount,
          repaymentPlan,
          0,
        );

  return {
    ...input,
    memberId: input.memberId ?? input.member_id,
    memberName: input.memberName ?? input.member_name ?? input.fullName ?? input.full_name,
    memberNumber: input.memberNumber ?? input.member_number ?? input.membershipNumber ?? input.membership_number,
    amount: Number.isNaN(amount) ? 0 : amount,
    duration: Number(input.duration ?? input.termMonths ?? input.term_months ?? 0) || 0,
    loanType: input.loanType ?? input.type ?? "short_term",
    balance,
    createdAt: toIsoDate(input.createdAt ?? input.appliedAt ?? input.applied_at) ?? new Date().toISOString(),
    status,
    approvedAt: toIsoDate(input.approvedAt ?? input.approved_at),
    rejectedAt: toIsoDate(input.rejectedAt ?? input.rejected_at),
    termsAccepted: Boolean(input.termsAccepted ?? input.terms_accepted ?? true),
    repaymentPlan,
    repaymentType: input.repaymentType ?? input.repayment_type ?? "equal_installments",
    interestCalculationModeApplied:
      input.interestCalculationModeApplied ?? input.interest_calculation_mode_applied ?? "flat",
    monthlyInterestRateApplied:
      Number(input.monthlyInterestRateApplied ?? input.monthly_interest_rate_applied ?? input.interestRatePct ?? input.interest_rate_pct ?? 0) || 0,
    repaymentStartMonth,
    firstRepaymentDate: toIsoDate(input.firstRepaymentDate ?? input.first_repayment_date),
    repaymentDayOfMonth: Number(input.repaymentDayOfMonth ?? input.repayment_day_of_month ?? 0) || undefined,
    repaymentPlanVersion: Number(input.repaymentPlanVersion ?? input.repayment_plan_version ?? 0) || undefined,
    repaymentPlanGeneratedAt: toIsoDate(input.repaymentPlanGeneratedAt ?? input.repayment_plan_generated_at),
    repaymentPlanBasis: input.repaymentPlanBasis ?? input.repayment_plan_basis,
    purpose: input.purpose ?? undefined,
    selectedMonths: Array.isArray(input.selectedMonths)
      ? input.selectedMonths
      : Array.isArray(input.selected_months)
      ? input.selected_months
      : undefined,
    borrowerCoverage: Number(input.borrowerCoverage ?? input.borrower_coverage ?? 0) || undefined,
    guarantorRequired:
      input.guarantorRequired ??
      (["pending_guarantor_approval", "pending_admin_approval", "guarantor_coverage_failed"].includes(status) ||
      String(input.status ?? "").trim().toLowerCase() === "guarantors_pending"),
  };
}

function normalizeLoanRepayment(input: any): LoanRepayment {
  const rawPaidAt = input.paidAt ?? input.paid_at;
  const paidAt =
    typeof rawPaidAt === "number"
      ? new Date(rawPaidAt).toISOString()
      : typeof rawPaidAt === "string"
      ? rawPaidAt
      : new Date().toISOString();

  return {
    id: input.id,
    loanId: input.loanId ?? input.loan_id,
    amount: Number(input.amount ?? 0),
    month: String(input.month ?? input.month),
    paidAt,
    isEarlyPayment: Boolean(input.isEarlyPayment ?? input.is_early_payment),
    paymentStatus: input.paymentStatus ?? input.payment_status ?? "paid",
  };
}

function normalizeSavings(input: any): Savings {
  return {
    id: input.id,
    memberId: input.memberId ?? input.member_id,
    amount: Number(input.amount ?? 0) || 0,
    month: input.month ?? "1970-01",
    status: input.status ?? "paid",
    paidAt: toIsoDate(input.paidAt ?? input.paid_at),
    createdAt: toIsoDate(input.createdAt ?? input.created_at ?? input.paidAt ?? input.paid_at) ?? new Date().toISOString(),
  };
}

function normalizeLoanCharge(input: any): LoanCharge {
  return {
    id: input.id,
    loanId: input.loanId ?? input.loan_id,
    description: input.description ?? input.note ?? String(input.kind ?? "Charge").replace(/_/g, " "),
    amount: Number(input.amount ?? 0),
    kind: input.kind,
    note: input.note ?? undefined,
    appliesToMonth: input.appliesToMonth ?? input.applies_to_month ?? undefined,
    createdAt: toIsoDate(input.createdAt ?? input.created_at) ?? new Date().toISOString(),
  };
}

function normalizeUnitTrust(input: any): UnitTrust {
  const amount = Number(input.amountFloat ?? input.amount ?? 0) || 0;
  return {
    ...input,
    type: input.type ?? input.kind,
    amount,
    amountFloat: amount,
    date: toIsoDate(input.date ?? input.occurredAt) ?? new Date().toISOString(),
    description: input.description ?? input.note,
    createdAt: toIsoDate(input.createdAt ?? input.created_at) ?? toIsoDate(input.occurredAt) ?? new Date().toISOString(),
  };
}

function normalizeLoanGuarantor(input: any): LoanGuarantor {
  return {
    id: input.id,
    loanId: input.loanId ?? input.loan_id,
    borrowerId: input.borrowerId ?? input.borrower_id ?? "",
    guarantorId: input.guarantorId ?? input.guarantor_id,
    guaranteeType: input.guaranteeType ?? input.guarantee_type ?? "amount",
    guaranteedPercent:
      Number(input.guaranteedPercent ?? input.guaranteed_percent ?? 0) || undefined,
    guaranteedAmount: Number(input.guaranteedAmount ?? input.guaranteed_amount ?? input.amount ?? 0) || 0,
    approvedAmount: Number(input.approvedAmount ?? input.approved_amount ?? 0) || undefined,
    securedOutstanding: Number(input.securedOutstanding ?? input.secured_outstanding ?? 0) || undefined,
    status: input.status ?? "pending",
    comment: input.comment ?? undefined,
    requestedAt: toIsoDate(input.requestedAt ?? input.requested_at ?? input.createdAt ?? input.created_at) ?? new Date().toISOString(),
    respondedAt: toIsoDate(input.respondedAt ?? input.responded_at),
    approvedAt: toIsoDate(input.approvedAt ?? input.approved_at),
    declinedAt: toIsoDate(input.declinedAt ?? input.declined_at),
    releasedAt: toIsoDate(input.releasedAt ?? input.released_at),
    createdAt: toIsoDate(input.createdAt ?? input.created_at) ?? new Date().toISOString(),
    updatedAt:
      toIsoDate(input.updatedAt ?? input.updated_at ?? input.respondedAt ?? input.responded_at ?? input.createdAt ?? input.created_at) ??
      new Date().toISOString(),
  };
}

function normalizeSubscription(input: any): Subscription {
  return {
    id: input.id,
    memberId: input.memberId ?? input.member_id,
    amount: Number(input.amount ?? 0) || 0,
    month:
      input.month ??
      (input.periodYear ? `${String(input.periodYear).padStart(4, "0")}-01` : undefined) ??
      "1970-01",
    status: input.status ?? undefined,
    paidAt: toIsoDate(input.paidAt ?? input.paid_at),
    createdAt: toIsoDate(input.createdAt ?? input.created_at) ?? toIsoDate(input.paidAt ?? input.paid_at) ?? new Date().toISOString(),
  };
}

function normalizeExpense(input: any): Expense {
  return {
    id: input.id,
    description: input.description ?? input.note ?? "",
    amount: Number(input.amount ?? 0) || 0,
    category: input.category ?? "Other",
    date: toIsoDate(input.date ?? input.incurredAt ?? input.incurred_at) ?? new Date().toISOString(),
    createdAt: toIsoDate(input.createdAt ?? input.created_at ?? input.incurredAt ?? input.incurred_at) ?? new Date().toISOString(),
  };
}

function normalizeLedgerEntry(input: any): LedgerEntry {
  const occurredAt = toIsoDate(input.occurredAt ?? input.occurred_at ?? input.createdAt ?? input.created_at) ?? new Date().toISOString();
  const month = input.month ?? occurredAt.slice(0, 7);
  const year = input.year ?? Number(month.slice(0, 4));
  const baseAmount = Number(input.amount ?? 0) || 0;
  const direction = String(input.direction ?? "").toLowerCase();
  const amount = direction === "credit" ? baseAmount : direction === "debit" ? -baseAmount : baseAmount;

  return {
    id: input.id,
    type: input.type ?? input.account ?? input.refType ?? "entry",
    amount,
    memberId: input.memberId ?? input.member_id,
    loanId: input.loanId ?? input.loan_id ?? input.refId,
    month,
    year: Number.isFinite(year) ? year : undefined,
    createdAt: toIsoDate(input.createdAt ?? input.created_at) ?? occurredAt,
    notes: input.notes ?? input.memo ?? undefined,
  };
}

function normalizeInterestMonthly(input: any): InterestMonthly {
  const month =
    input.month ??
    (input.periodYear && input.periodMonth
      ? `${String(input.periodYear).padStart(4, "0")}-${String(input.periodMonth).padStart(2, "0")}`
      : "1970-01");

  return {
    id: input.id,
    month,
    year: Number(input.year ?? input.periodYear ?? month.slice(0, 4)) || 0,
    loanInterestTotal: Number(input.loanInterestTotal ?? input.loan_interest_total ?? input.amount ?? 0) || 0,
    trustInterestTotal: Number(input.trustInterestTotal ?? input.trust_interest_total ?? 0) || 0,
    loanInterestRetained: Number(input.loanInterestRetained ?? input.loan_interest_retained ?? 0) || 0,
    trustInterestRetained: Number(input.trustInterestRetained ?? input.trust_interest_retained ?? 0) || 0,
    loanInterestDistributed: Number(input.loanInterestDistributed ?? input.loan_interest_distributed ?? 0) || 0,
    trustInterestDistributed: Number(input.trustInterestDistributed ?? input.trust_interest_distributed ?? 0) || 0,
    closedAt: toIsoDate(input.closedAt ?? input.closed_at),
    closedBy: input.closedBy ?? input.closed_by ?? undefined,
    createdAt: toIsoDate(input.createdAt ?? input.created_at) ?? new Date(`${month}-01T00:00:00.000Z`).toISOString(),
    notes: input.notes ?? undefined,
  };
}

function normalizeInterestAllocation(input: any): InterestAllocation {
  const month =
    input.month ??
    (input.periodYear && input.periodMonth
      ? `${String(input.periodYear).padStart(4, "0")}-${String(input.periodMonth).padStart(2, "0")}`
      : "1970-01");

  return {
    id: input.id,
    memberId: input.memberId ?? input.member_id,
    month,
    year: Number(input.year ?? input.periodYear ?? month.slice(0, 4)) || 0,
    loanInterest: Number(input.loanInterest ?? input.loan_interest ?? 0) || 0,
    trustInterest: Number(input.trustInterest ?? input.unitTrustInterest ?? input.unit_trust_interest ?? 0) || 0,
    totalInterest: Number(input.totalInterest ?? input.total_interest ?? 0) || 0,
    createdAt: toIsoDate(input.createdAt ?? input.created_at) ?? new Date(`${month}-01T00:00:00.000Z`).toISOString(),
  };
}

function normalizeRetainedEarnings(input: any): RetainedEarnings {
  const month =
    input.month ??
    (input.periodYear && input.periodMonth
      ? `${String(input.periodYear).padStart(4, "0")}-${String(input.periodMonth).padStart(2, "0")}`
      : `${String(input.year ?? input.periodYear ?? 1970).padStart(4, "0")}-01`);

  return {
    id: input.id,
    year: Number(input.year ?? input.periodYear ?? 0) || 0,
    month,
    source: input.source ?? "loan",
    grossInterest: Number(input.grossInterest ?? input.gross_interest ?? 0) || 0,
    retentionPercentage: Number(input.retentionPercentage ?? input.retention_pct ?? input.percentage ?? input.amount ?? 0) || 0,
    retainedAmount: Number(input.retainedAmount ?? input.retained_amount ?? 0) || 0,
    distributedAmount: Number(input.distributedAmount ?? input.distributed_amount ?? 0) || 0,
    createdAt: toIsoDate(input.createdAt ?? input.created_at) ?? new Date().toISOString(),
    notes: input.notes ?? undefined,
  };
}

function normalizeEarlyRepaymentRequest(input: any): LoanEarlyRepaymentRequest {
  const requestedAt = toIsoDate(input.requestedAt ?? input.requested_at) ?? new Date().toISOString();
  const month =
    input.month ??
    (typeof input.requestedForDate === "string" ? input.requestedForDate.slice(0, 7) : undefined) ??
    (typeof input.requested_for_date === "number" ? new Date(input.requested_for_date).toISOString().slice(0, 7) : undefined) ??
    requestedAt.slice(0, 7);

  return {
    id: input.id,
    loanId: input.loanId ?? input.loan_id,
    memberId: input.memberId ?? input.member_id,
    status: input.status ?? "pending",
    month,
    amount: Number(input.amount ?? 0) || 0,
    interestCalculationModeApplied:
      input.interestCalculationModeApplied ?? input.interest_calculation_mode ?? "flat",
    monthlyInterestRateApplied:
      Number(input.monthlyInterestRateApplied ?? input.monthly_interest_rate ?? 0) || 0,
    penaltyRateApplied:
      Number(input.penaltyRateApplied ?? input.penalty_rate ?? 0) || 0,
    interestAmount: Number(input.interestAmount ?? input.interest_amount ?? 0) || 0,
    principalAmount: Number(input.principalAmount ?? input.principal_amount ?? 0) || 0,
    chargeAmount: Number(input.chargeAmount ?? input.charge_amount ?? 0) || 0,
    balanceAtRequest: Number(input.balanceAtRequest ?? input.balance_at_request ?? 0) || 0,
    requestedAt,
    requestedForDate: toIsoDate(input.requestedForDate ?? input.requested_for_date),
    resolvedAt: toIsoDate(input.resolvedAt ?? input.resolved_at),
    paidAt: toIsoDate(input.paidAt ?? input.paid_at),
    adminComment: input.adminComment ?? input.admin_comment ?? undefined,
  };
}

function normalizeDocumentRecord(input: any): DocumentRecord {
  const objectKey = input.objectKey ?? input.object_key ?? input.fileId ?? input.file_id ?? "";

  return {
    id: input.id,
    title: input.title ?? "",
    categoryId: input.categoryId ?? input.category_id ?? undefined,
    category: input.category ?? input.categoryName ?? "Uncategorized",
    scope: input.scope ?? "general",
    fileId: objectKey,
    objectKey,
    bucketId: input.bucketId ?? "documents",
    contentType: input.contentType ?? input.content_type ?? undefined,
    sizeBytes: Number(input.sizeBytes ?? input.size_bytes ?? 0) || undefined,
    uploadedBy: input.uploadedBy ?? input.uploaded_by ?? "",
    uploadedAt: toIsoDate(input.uploadedAt ?? input.uploaded_at) ?? new Date().toISOString(),
    tags: Array.isArray(input.tags) ? input.tags : typeof input.tags === "string" ? input.tags.split(",").map((tag: string) => tag.trim()).filter(Boolean) : undefined,
    period: input.period ?? undefined,
    notes: input.notes ?? undefined,
  };
}

function normalizeMember(input: any): Member {
  return {
    ...input,
    id: input.id,
    name: input.name ?? input.fullName ?? input.full_name,
    email: input.email,
    phone: input.phone ?? undefined,
    membershipNumber: input.membershipNumber ?? input.membership_number ?? "",
    authUserId: input.authUserId ?? input.auth_user_id,
    joinDate: input.joinDate ?? input.joinedAt ?? input.joined_at ?? new Date().toISOString(),
    status: input.status ?? "active",
    avatarUrl: input.avatarUrl ?? input.avatar_url ?? undefined,
  };
}

function normalizeFinancialConfig(input: any): FinancialConfig {
  return {
    id: String(input?.id ?? "1"),
    loanInterestRate: Number(input?.loanInterestRate ?? input?.shortTermRatePct ?? input?.short_term_rate_pct ?? 0) || 0,
    longTermInterestRate: Number(input?.longTermInterestRate ?? input?.longTermRatePct ?? input?.long_term_rate_pct ?? 0) || 0,
    longTermLoansEnabled: Boolean(
      input?.longTermLoansEnabled ?? input?.long_term_loans_enabled ?? input?.longTermEnabled ?? input?.long_term_enabled ?? true,
    ),
    loanInterestRetentionPercentage:
      Number(input?.loanInterestRetentionPercentage ?? input?.loanInterestRetentionPct ?? input?.loan_interest_retention_pct ?? 20) || 0,
    trustInterestRetentionPercentage:
      Number(input?.trustInterestRetentionPercentage ?? input?.trustInterestRetentionPct ?? input?.trust_interest_retention_pct ?? 30) || 0,
    interestCalculationMode: input?.interestCalculationMode ?? input?.interest_calculation_mode ?? "flat",
    loanEligibilityPercentage:
      Number(input?.loanEligibilityPercentage ?? input?.loanEligibilityPct ?? input?.loan_eligibility_pct ?? 0) || 0,
    defaultBankCharge: Number(input?.defaultBankCharge ?? input?.default_bank_charge ?? 0) || 0,
    earlyRepaymentPenalty: Number(input?.earlyRepaymentPenalty ?? input?.early_repayment_penalty ?? 0) || 0,
    maxLoanDuration: Number(input?.maxLoanDuration ?? input?.max_loan_duration ?? seedFinancialConfig.maxLoanDuration) || seedFinancialConfig.maxLoanDuration,
    longTermMaxRepaymentMonths:
      Number(
        input?.longTermMaxRepaymentMonths ??
        input?.long_term_max_repayment_months ??
        input?.maxLoanDuration ??
        input?.max_loan_duration ??
        seedFinancialConfig.longTermMaxRepaymentMonths,
      ) || seedFinancialConfig.longTermMaxRepaymentMonths,
    minLoanAmount: Number(input?.minLoanAmount ?? input?.min_loan_amount ?? 0) || 0,
    maxLoanAmount: Number(input?.maxLoanAmount ?? input?.max_loan_amount ?? 0) || 0,
    logoFileId: input?.logoFileId ?? input?.logo_file_id ?? undefined,
    logoBucketId: input?.logoBucketId ?? input?.logo_bucket_id ?? undefined,
  };
}

export interface DocumentRegistrationInput {
  categoryId?: ID | null;
  title: string;
  objectKey: string;
  contentType?: string;
  sizeBytes?: number;
  tags?: string[];
  period?: string;
  notes?: string;
  scope?: DocumentScope;
}

export interface DocumentUpdateInput {
  title?: string;
  categoryId?: ID | null;
  tags?: string[];
  period?: string;
  notes?: string;
  scope?: DocumentScope;
}

function serializeFinancialConfigPatch(patch: Partial<FinancialConfig>) {
  return {
    shortTermRatePct: patch.loanInterestRate,
    longTermRatePct: patch.longTermInterestRate,
    longTermLoansEnabled: patch.longTermLoansEnabled,
    loanInterestRetentionPct: patch.loanInterestRetentionPercentage,
    trustInterestRetentionPct: patch.trustInterestRetentionPercentage,
    interestCalculationMode: patch.interestCalculationMode,
    loanEligibilityPct: patch.loanEligibilityPercentage,
    defaultBankCharge: patch.defaultBankCharge,
    earlyRepaymentPenalty: patch.earlyRepaymentPenalty,
    maxLoanDuration: patch.maxLoanDuration,
    longTermMaxRepaymentMonths: patch.longTermMaxRepaymentMonths,
    minLoanAmount: patch.minLoanAmount,
    maxLoanAmount: patch.maxLoanAmount,
  };
}

// Simulated network latency for realistic loading states when using seeds
const delay = <T,>(value: T, ms = 200): Promise<T> =>
  new Promise((resolve) => setTimeout(() => resolve(value), ms));

const notWired = (op: string) =>
  Promise.reject(
    new Error(
      `${op} requires the Cloudflare Worker. Set VITE_API_BASE_URL and implement the corresponding route.`
    )
  );

function normalizeAuthUser(input: any): AuthUser {
  return {
    id: input.id,
    email: input.email,
    name: input.name ?? input.displayName ?? input.display_name ?? input.email,
    memberId: input.memberId ?? input.member_id ?? undefined,
    roles: Array.isArray(input.roles) ? input.roles : [],
    avatarUrl: input.avatarUrl ?? input.avatar_url ?? undefined,
  };
}

// ---------- Auth ----------
export const authService = {
  list: () => (isApiConfigured() ? api.get<AuthUser[]>("/api/auth/users").then((rows) => rows.map(normalizeAuthUser)) : delay(seedAuthUsers)),
  findByEmail: (email: string) =>
    isApiConfigured()
      ? api.get<AuthUser | null>("/api/auth/lookup", { email }).then((row) => (row ? normalizeAuthUser(row) : null))
      : delay(seedAuthUsers.find((u) => u.email.toLowerCase() === email.toLowerCase()) ?? null),
  signInWithEmail: (email: string, password: string) =>
    isApiConfigured()
      ? api.post<AuthUser>("/api/auth/sign-in", { email, password }).then(normalizeAuthUser)
      : notWired("auth.signInWithEmail"),
  signOut: () => (isApiConfigured() ? api.post<void>("/api/auth/sign-out") : Promise.resolve()),
  me: () => (isApiConfigured() ? api.get<AuthUser>("/api/auth/me").then(normalizeAuthUser) : delay(seedAuthUsers[0])),
};

// ---------- Members ----------
export const membersService = {
  list: () =>
    isApiConfigured()
      ? api.get<Member[]>("/api/members").then((rows) => rows.map(normalizeMember))
      : delay(seedMembers),
  get: (id: ID) =>
    isApiConfigured()
      ? api.get<Member | null>(`/api/members/${id}`).then((row) => (row ? normalizeMember(row) : null))
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
  list: () => (isApiConfigured() ? api.get<Savings[]>("/api/savings").then((rows) => rows.map(normalizeSavings)) : delay(seedSavings)),
  byMember: (memberId: ID) =>
    isApiConfigured()
      ? api.get<Savings[]>(`/api/members/${memberId}/savings`).then((rows) => rows.map(normalizeSavings))
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
    isApiConfigured()
      ? api.post<Savings>("/api/savings", {
          memberId: input.memberId,
          periodYear: Number(String(input.month).slice(0, 4)),
          periodMonth: Number(String(input.month).slice(5, 7)),
          amount: input.amount,
          status: input.status ?? "paid",
          paidAt: input.paidAt ? new Date(input.paidAt).getTime() : undefined,
        })
      : notWired("savings.add"),
  // Server-authoritative: writes ledger entries in the same D1 transaction
  batchAdd: (inputs: Array<Omit<Savings, "id" | "createdAt">>) =>
    isApiConfigured()
      ? api.post<Savings[]>("/api/savings/batch", {
          entries: inputs.map((input) => ({
            memberId: input.memberId,
            periodYear: Number(String(input.month).slice(0, 4)),
            periodMonth: Number(String(input.month).slice(5, 7)),
            amount: input.amount,
            status: input.status ?? "paid",
            paidAt: input.paidAt ? new Date(input.paidAt).getTime() : undefined,
          })),
        }).then((rows) => rows.map(normalizeSavings))
      : notWired("savings.batchAdd"),
};

// ---------- Loans ----------
export const loansService = {
  list: () =>
    isApiConfigured()
      ? api.get<Loan[]>("/api/loans").then((rows) => rows.map(normalizeLoan))
      : delay(seedLoans),
  byMember: (memberId: ID) =>
    isApiConfigured()
      ? api.get<Loan[]>(`/api/members/${memberId}/loans`).then((rows) => rows.map(normalizeLoan))
      : delay(seedLoans.filter((l) => l.memberId === memberId)),
  get: (id: ID) =>
    isApiConfigured()
      ? api.get<Loan | null>(`/api/loans/${id}`).then((row) => (row ? normalizeLoan(row) : null))
      : delay(seedLoans.find((l) => l.id === id) ?? null),
  validate: (input: unknown) =>
    isApiConfigured() ? api.post<{ ok: boolean; reasons?: string[] }>("/api/loans/validate", input) : notWired("loans.validate"),
  submitLongTerm: (input: unknown) =>
    isApiConfigured() ? api.post<Loan>("/api/loans", input).then(normalizeLoan) : notWired("loans.submitLongTerm"),
  finalApprove: (loanId: ID) =>
    isApiConfigured() ? api.post<Loan>(`/api/loans/${loanId}/final-approve`).then(normalizeLoan) : notWired("loans.finalApprove"),
  reject: (loanId: ID, reason: string) =>
    isApiConfigured() ? api.post<Loan>(`/api/loans/${loanId}/reject`, { reason }).then(normalizeLoan) : notWired("loans.reject"),
  update: (id: ID, patch: Partial<Loan>) =>
    isApiConfigured() ? api.patch<Loan>(`/api/loans/${id}`, patch).then(normalizeLoan) : notWired("loans.update"),
  remove: (id: ID) =>
    isApiConfigured() ? api.delete<void>(`/api/loans/${id}`) : notWired("loans.remove"),
};

export const loanRepaymentsService = {
  list: () =>
    isApiConfigured()
      ? api.get<LoanRepayment[]>("/api/loans/repayments").then((rows) => rows.map(normalizeLoanRepayment))
      : delay(seedLoanRepayments),
  byLoan: (loanId: ID) =>
    isApiConfigured()
      ? api.get<LoanRepayment[]>(`/api/loans/${loanId}/repayments`).then((rows) => rows.map(normalizeLoanRepayment))
      : delay(seedLoanRepayments.filter((r) => r.loanId === loanId)),
  // Server-authoritative: allocates between borrower & guarantor coverage
  record: (input: Omit<LoanRepayment, "id">) =>
    isApiConfigured()
      ? api.post<LoanRepayment>(`/api/loans/${input.loanId}/repayments`, {
          ...input,
          paidAt: input.paidAt ? new Date(input.paidAt).getTime() : undefined,
        }).then(normalizeLoanRepayment)
      : notWired("loanRepayments.record"),
  batchRecord: (inputs: Array<Omit<LoanRepayment, "id">>) =>
    isApiConfigured()
      ? api.post<LoanRepayment[]>("/api/loans/repayments/batch", {
          entries: inputs.map((input) => ({
            ...input,
            paidAt: input.paidAt ? new Date(input.paidAt).getTime() : undefined,
          })),
        }).then((rows) => rows.map(normalizeLoanRepayment))
      : notWired("loanRepayments.batchRecord"),
};

export const loanChargesService = {
  list: () =>
    isApiConfigured()
      ? api.get<LoanCharge[]>("/api/loans/charges").then((rows) => rows.map(normalizeLoanCharge))
      : delay(seedLoanCharges),
  byLoan: (loanId: ID) =>
    isApiConfigured()
      ? api.get<LoanCharge[]>(`/api/loans/${loanId}/charges`).then((rows) => rows.map(normalizeLoanCharge))
      : delay(seedLoanCharges.filter((c) => c.loanId === loanId)),
  add: (input: Omit<LoanCharge, "id" | "createdAt">) =>
    isApiConfigured() ? api.post<LoanCharge>(`/api/loans/${input.loanId}/charges`, input).then(normalizeLoanCharge) : notWired("loanCharges.add"),
  update: (id: ID, patch: Partial<LoanCharge>) =>
    isApiConfigured() ? api.patch<LoanCharge>(`/api/loan-charges/${id}`, patch) : notWired("loanCharges.update"),
  remove: (id: ID) =>
    isApiConfigured() ? api.delete<void>(`/api/loans/charges/${id}`) : notWired("loanCharges.remove"),
};

export const loanGuarantorsService = {
  list: () =>
    isApiConfigured()
      ? api.get<LoanGuarantor[]>("/api/guarantor-requests").then((rows) => rows.map(normalizeLoanGuarantor))
      : delay(seedLoanGuarantors),
  byLoan: (loanId: ID) =>
    isApiConfigured()
      ? api.get<LoanGuarantor[]>(`/api/loans/${loanId}/guarantors`).then((rows) => rows.map(normalizeLoanGuarantor))
      : delay(seedLoanGuarantors.filter((g) => g.loanId === loanId)),
  pendingForGuarantor: (memberId: ID) =>
    isApiConfigured()
      ? api.get<LoanGuarantor[]>(`/api/members/${memberId}/guarantor-requests`, { status: "pending" }).then((rows) => rows.map(normalizeLoanGuarantor))
      : delay(seedLoanGuarantors.filter((g) => g.guarantorId === memberId && g.status === "pending")),
  byGuarantor: (memberId: ID) =>
    isApiConfigured()
      ? api.get<LoanGuarantor[]>(`/api/members/${memberId}/guarantor-requests`).then((rows) => rows.map(normalizeLoanGuarantor))
      : delay(seedLoanGuarantors.filter((g) => g.guarantorId === memberId)),
  // Server-authoritative: must verify caller identity = guarantor
  respond: (id: ID, decision: "approve" | "decline", comment?: string) =>
    isApiConfigured()
      ? api.post<LoanGuarantor>(`/api/guarantor-requests/${id}/respond`, { decision, comment }).then(normalizeLoanGuarantor)
      : notWired("loanGuarantors.respond"),
};

export const earlyRepaymentService = {
  list: () =>
    isApiConfigured()
      ? api.get<LoanEarlyRepaymentRequest[]>("/api/early-repayments").then((rows) => rows.map(normalizeEarlyRepaymentRequest))
      : delay(seedEarlyRepaymentRequests),
  byMember: (memberId: ID) =>
    isApiConfigured()
      ? api.get<LoanEarlyRepaymentRequest[]>(`/api/members/${memberId}/early-repayments`).then((rows) => rows.map(normalizeEarlyRepaymentRequest))
      : delay(seedEarlyRepaymentRequests.filter((r) => r.memberId === memberId)),
  request: (input: { loanId: ID; requestedForDate?: string }) =>
    isApiConfigured()
      ? api.post<LoanEarlyRepaymentRequest>("/api/early-repayments", {
          loanId: input.loanId,
          requestedForDate: input.requestedForDate ? new Date(input.requestedForDate).getTime() : undefined,
        }).then(normalizeEarlyRepaymentRequest)
      : notWired("earlyRepayment.request"),
  cancel: (id: ID) =>
    isApiConfigured() ? api.post<void>(`/api/early-repayments/${id}/cancel`) : notWired("earlyRepayment.cancel"),
  approve: (id: ID, adminComment?: string) =>
    isApiConfigured()
      ? api.post<LoanEarlyRepaymentRequest>(`/api/early-repayments/${id}/approve`, { adminComment }).then(normalizeEarlyRepaymentRequest)
      : notWired("earlyRepayment.approve"),
  reject: (id: ID, adminComment?: string) =>
    isApiConfigured()
      ? api.post<LoanEarlyRepaymentRequest>(`/api/early-repayments/${id}/reject`, { adminComment }).then(normalizeEarlyRepaymentRequest)
      : notWired("earlyRepayment.reject"),
  markPaid: (id: ID) =>
    isApiConfigured() ? api.post<void>(`/api/early-repayments/${id}/mark-paid`) : notWired("earlyRepayment.markPaid"),
};

// ---------- Subscriptions ----------
export const subscriptionsService = {
  list: () =>
    (isApiConfigured()
      ? api.get<Subscription[]>("/api/subscriptions").then((rows) => rows.map(normalizeSubscription))
      : delay(seedSubscriptions)),
  byMember: (memberId: ID) =>
    isApiConfigured()
      ? api.get<Subscription[]>(`/api/members/${memberId}/subscriptions`).then((rows) => rows.map(normalizeSubscription))
      : delay(seedSubscriptions.filter((s) => s.memberId === memberId)),
  add: (input: Omit<Subscription, "id" | "createdAt">) =>
    isApiConfigured() ? api.post<Subscription>("/api/subscriptions", input) : notWired("subscriptions.add"),
};

// ---------- Expenses ----------
export const expensesService = {
  list: () =>
    (isApiConfigured()
      ? api.get<Expense[]>("/api/expenses").then((rows) => rows.map(normalizeExpense))
      : delay(seedExpenses)),
  add: (input: Omit<Expense, "id" | "createdAt">) =>
    isApiConfigured() ? api.post<Expense>("/api/expenses", input) : notWired("expenses.add"),
  update: (id: ID, patch: Partial<Expense>) =>
    isApiConfigured() ? api.patch<Expense>(`/api/expenses/${id}`, patch) : notWired("expenses.update"),
  remove: (id: ID) =>
    isApiConfigured() ? api.delete<void>(`/api/expenses/${id}`) : notWired("expenses.remove"),
};

// ---------- Unit Trust ----------
export const unitTrustService = {
  list: () =>
    isApiConfigured()
      ? api.get<UnitTrust[]>("/api/unit-trust").then((rows) => rows.map(normalizeUnitTrust))
      : delay(seedUnitTrust),
  add: (input: Omit<UnitTrust, "id" | "createdAt">) =>
    isApiConfigured() ? api.post<UnitTrust>("/api/unit-trust", input).then(normalizeUnitTrust) : notWired("unitTrust.add"),
  update: (id: ID, input: Omit<UnitTrust, "id" | "createdAt">) =>
    isApiConfigured() ? api.patch<UnitTrust>(`/api/unit-trust/${id}`, input).then(normalizeUnitTrust) : notWired("unitTrust.update"),
  remove: (id: ID) =>
    isApiConfigured() ? api.delete<void>(`/api/unit-trust/${id}`) : notWired("unitTrust.remove"),
};

// ---------- Documents (R2-backed) ----------
//
// Upload flow:
//   1. Client calls `uploadToR2(file)` → POST /api/uploads/sign → PUT to R2.
//   2. Client calls `documentsService.register({ ...meta, objectKey })` so the
//      Worker writes a row in D1 and links it to the R2 object.
export const documentsService = {
  list: () =>
    (isApiConfigured()
      ? api.get<DocumentRecord[]>("/api/documents").then((rows) => rows.map(normalizeDocumentRecord))
      : delay(seedDocuments)),
  categories: () =>
    isApiConfigured() ? api.get<DocumentCategory[]>("/api/document-categories") : delay(seedDocumentCategories),
  get: (id: ID) =>
    isApiConfigured() ? api.get<DocumentRecord>(`/api/documents/${id}`).then(normalizeDocumentRecord) : notWired("documents.get"),
  loanTerms: () =>
    isApiConfigured()
      ? api.get<DocumentRecord | null>("/api/documents/loan-terms").then((row) => (row ? normalizeDocumentRecord(row) : null))
      : delay(
          seedDocuments.find((document) => document.scope === "loan_terms" || /loan terms/i.test(document.title)) ?? null
        ),
  register: (input: DocumentRegistrationInput) =>
    isApiConfigured() ? api.post<DocumentRecord>("/api/documents", input).then(normalizeDocumentRecord) : notWired("documents.register"),
  update: (id: ID, input: DocumentUpdateInput) =>
    isApiConfigured() ? api.patch<DocumentRecord>(`/api/documents/${id}`, input).then(normalizeDocumentRecord) : notWired("documents.update"),
  downloadUrl: (id: ID) =>
    isApiConfigured() ? api.get<{ url: string }>(`/api/documents/${id}/download`).then(r => r.url) : notWired("documents.downloadUrl"),
  remove: (id: ID) =>
    isApiConfigured() ? api.delete<void>(`/api/documents/${id}`) : notWired("documents.remove"),
};

// ---------- Reports / Ledger ----------
export const reportsService = {
  ledger: () =>
    (isApiConfigured()
      ? api.get<LedgerEntry[]>("/api/reports/ledger").then((rows) => rows.map(normalizeLedgerEntry))
      : delay(seedLedger)),
  interestMonthly: () =>
    isApiConfigured()
      ? api.get<InterestMonthly[]>("/api/reports/interest-monthly").then((rows) => rows.map(normalizeInterestMonthly))
      : delay(seedInterestMonthly),
  interestAllocations: (memberId?: ID) =>
    isApiConfigured()
      ? api
          .get<InterestAllocation[]>("/api/reports/interest-allocations", memberId ? { memberId } : undefined)
          .then((rows) => rows.map(normalizeInterestAllocation))
      : delay(memberId ? seedInterestAllocations.filter((row) => row.memberId === memberId) : seedInterestAllocations),
  retainedEarnings: () =>
    isApiConfigured()
      ? api.get<RetainedEarnings[]>("/api/reports/retained-earnings").then((rows) => rows.map(normalizeRetainedEarnings))
      : delay(seedRetainedEarnings),
  previewInterestClose: (month: string, notes?: string) =>
    isApiConfigured()
      ? api.post("/api/reports/interest-close/preview", { month, notes })
      : notWired("reports.previewInterestClose"),
  postInterestClose: (month: string, notes?: string) =>
    isApiConfigured()
      ? api.post("/api/reports/interest-close/post", { month, notes })
      : notWired("reports.postInterestClose"),
};

// ---------- Financial Config ----------
export const financialConfigService = {
  get: () =>
    (isApiConfigured()
      ? api.get<FinancialConfig>("/api/financial-config").then(normalizeFinancialConfig)
      : delay(seedFinancialConfig)),
  update: (patch: Partial<FinancialConfig>) =>
    isApiConfigured()
      ? api.patch<FinancialConfig>("/api/financial-config", serializeFinancialConfigPatch(patch)).then(normalizeFinancialConfig)
      : notWired("financialConfig.update"),
};

// ---------- App Config ----------
export interface AppConfig {
  allowEmailLogin: boolean;
}

export const configService = {
  get: () =>
    isApiConfigured()
      ? api.get<AppConfig>("/api/config")
      : delay({ allowEmailLogin: import.meta.env.VITE_ALLOW_EMAIL_LOGIN !== "false" }),
};
