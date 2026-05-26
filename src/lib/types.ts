// Domain types — shaped for Cloudflare Workers + D1 backend integration.
// All IDs are strings; legacy Appwrite IDs are preserved as-is during import.

export type ID = string;
export type ISODate = string; // ISO 8601
export type MonthString = string; // "YYYY-MM"

export type MemberStatus = "active" | "inactive" | "suspended";

export interface Member {
  id: ID;
  name: string;
  email: string;
  phone?: string;
  membershipNumber: string;
  authUserId?: string;
  joinDate: ISODate;
  status: MemberStatus;
  avatarUrl?: string;
}

export interface Savings {
  id: ID;
  memberId: ID;
  amount: number; // UGX
  month: MonthString;
  status?: "paid" | "partial" | "missed";
  paidAt?: ISODate;
  createdAt: ISODate;
}

export type LoanType = "short_term" | "long_term";
export type RepaymentType = "equal_installments" | "custom";
export type InterestMode = "flat" | "reducing_balance";
export type RepaymentStatus = "pending" | "paid" | "late" | "early";
export type LoanChargeKind = "processing_fee" | "penalty" | "insurance" | "other";
export type LoanStatus =
  | "pending_guarantor_approval"
  | "pending_admin_approval"
  | "active"
  | "completed"
  | "rejected"
  | "guarantor_coverage_failed";

export interface RepaymentPlanItem {
  installmentNumber?: number;
  month: MonthString;
  dueDate?: ISODate;
  principal: number;
  interest: number;
  chargeAmount?: number;
  chargeId?: ID;
  chargeLabel?: string;
  baseTotal?: number;
  total: number;
  balance: number;
  status: RepaymentStatus;
  paymentId?: ID;
  paidAt?: ISODate;
}

export interface Loan {
  id: ID;
  memberId: ID;
  memberName?: string;
  memberNumber?: string;
  amount: number;
  duration: number;
  selectedMonths?: MonthString[];
  loanType: LoanType;
  termsAccepted: boolean;
  purpose?: string;
  repaymentType: RepaymentType;
  repaymentPlan?: RepaymentPlanItem[];
  interestCalculationModeApplied: InterestMode;
  monthlyInterestRateApplied: number;
  repaymentStartMonth?: MonthString;
  firstRepaymentDate?: ISODate;
  repaymentDayOfMonth?: number;
  repaymentPlanVersion?: number;
  repaymentPlanGeneratedAt?: ISODate;
  repaymentPlanBasis?: string;
  status: LoanStatus;
  createdAt: ISODate;
  approvedAt?: ISODate;
  rejectedAt?: ISODate;
  balance: number;
  guarantorRequired: boolean;
  borrowerCoverage?: number;
  guarantorGapAmount?: number;
  guarantorRequestedAmount?: number;
  guarantorApprovedAmount?: number;
  guarantorApprovalStatus?: "pending" | "partial" | "complete" | "failed";
  securedOriginalTotal?: number;
  securedOutstandingTotal?: number;
  guarantorPrincipalRecoveredTotal?: number;
  borrowerPrincipalRecoveredTotal?: number;
  repaymentAllocationStatus?: string;
  lastRepaymentAllocationAt?: ISODate;
  guarantorSettlementCompletedAt?: ISODate;
}

export interface LoanRepayment {
  id: ID;
  loanId: ID;
  amount: number;
  month: MonthString;
  paidAt: ISODate;
  isEarlyPayment?: boolean;
  paymentStatus: RepaymentStatus;
}

export interface LoanCharge {
  id: ID;
  loanId: ID;
  description: string;
  amount: number;
  kind?: LoanChargeKind;
  note?: string;
  appliesToMonth?: MonthString;
  createdAt: ISODate;
}

export type GuarantorStatus = "pending" | "approved" | "declined" | "released";

export interface LoanGuarantor {
  id: ID;
  loanId: ID;
  borrowerId: ID;
  guarantorId: ID;
  guaranteeType: "percentage" | "amount";
  guaranteedPercent?: number;
  guaranteedAmount: number;
  approvedAmount?: number;
  securedOutstanding?: number;
  status: GuarantorStatus;
  comment?: string;
  requestedAt: ISODate;
  respondedAt?: ISODate;
  approvedAt?: ISODate;
  declinedAt?: ISODate;
  releasedAt?: ISODate;
  createdAt: ISODate;
  updatedAt: ISODate;
}

export type EarlyRepaymentStatus = "pending" | "approved" | "rejected" | "paid" | "cancelled";

export interface LoanEarlyRepaymentRequest {
  id: ID;
  loanId: ID;
  memberId: ID;
  status: EarlyRepaymentStatus;
  month: MonthString;
  amount: number;
  interestCalculationModeApplied: InterestMode;
  monthlyInterestRateApplied: number;
  penaltyRateApplied: number;
  interestAmount: number;
  principalAmount: number;
  chargeAmount: number;
  balanceAtRequest: number;
  requestedAt: ISODate;
  requestedForDate?: ISODate;
  resolvedAt?: ISODate;
  paidAt?: ISODate;
  adminComment?: string;
}

export interface Subscription {
  id: ID;
  memberId: ID;
  amount: number;
  month: MonthString; // also serves as year tracking
  status?: "paid" | "due" | "overdue";
  paidAt?: ISODate;
  createdAt: ISODate;
}

export interface Expense {
  id: ID;
  description: string;
  amount: number;
  category: string;
  date: ISODate;
  createdAt: ISODate;
}

export interface UnitTrust {
  id: ID;
  type: "deposit" | "withdrawal" | "interest";
  amount: number;
  amountFloat?: number;
  description?: string;
  date: ISODate;
  createdAt: ISODate;
}

export interface FinancialConfig {
  id: ID;
  loanInterestRate: number; // monthly %, short-term
  longTermInterestRate: number; // monthly %, long-term
  longTermLoansEnabled: boolean;
  loanInterestRetentionPercentage: number;
  trustInterestRetentionPercentage: number;
  interestCalculationMode: InterestMode;
  loanEligibilityPercentage: number; // % of savings
  defaultBankCharge: number;
  earlyRepaymentPenalty: number; // %
  maxLoanDuration: number; // months, short-term
  longTermMaxRepaymentMonths: number;
  minLoanAmount: number;
  maxLoanAmount: number;
  logoFileId?: string;
  logoBucketId?: string;
}

export interface LedgerEntry {
  id: ID;
  type: string;
  amount: number;
  memberId?: ID;
  loanId?: ID;
  month?: MonthString;
  year?: number;
  createdAt: ISODate;
  notes?: string;
}

export interface InterestMonthly {
  id: ID;
  month: MonthString;
  year: number;
  loanInterestTotal: number;
  trustInterestTotal: number;
  loanInterestRetained: number;
  trustInterestRetained: number;
  loanInterestDistributed: number;
  trustInterestDistributed: number;
  closedAt?: ISODate;
  closedBy?: ID;
  createdAt: ISODate;
  notes?: string;
}

export interface InterestAllocation {
  id: ID;
  memberId: ID;
  month: MonthString;
  year: number;
  loanInterest: number;
  trustInterest: number;
  totalInterest: number;
  createdAt: ISODate;
}

export interface RetainedEarnings {
  id: ID;
  year: number;
  month: MonthString;
  source: "loan" | "trust";
  grossInterest: number;
  retentionPercentage: number;
  retainedAmount: number;
  distributedAmount: number;
  createdAt: ISODate;
  notes?: string;
}

export type DocumentScope = "general" | "loan_terms";

export interface DocumentRecord {
  id: ID;
  title: string;
  categoryId?: ID;
  category: string;
  scope?: DocumentScope;
  fileId: string;
  objectKey?: string;
  bucketId: string;
  contentType?: string;
  sizeBytes?: number;
  uploadedBy: ID;
  uploadedAt: ISODate;
  tags?: string[];
  period?: string;
  notes?: string;
}

export interface DocumentCategory {
  id: ID;
  name: string;
  description?: string;
  createdAt: ISODate;
  updatedAt: ISODate;
}

export type AppRole = "admin" | "member";

export interface AuthUser {
  id: ID;
  email: string;
  name: string;
  memberId?: ID;
  roles: AppRole[];
  avatarUrl?: string;
}
