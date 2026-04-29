// React Query hooks over the service layer.
// Components use these so swapping the underlying transport (Workers/D1) is a localized change.

import { useQuery } from "@tanstack/react-query";
import {
  documentsService,
  earlyRepaymentService,
  expensesService,
  financialConfigService,
  loanChargesService,
  loanGuarantorsService,
  loanRepaymentsService,
  loansService,
  membersService,
  reportsService,
  savingsService,
  subscriptionsService,
  unitTrustService,
} from "@/services";
import type { ID } from "@/lib/types";

export const queryKeys = {
  members: ["members"] as const,
  member: (id: ID) => ["members", id] as const,
  savings: ["savings"] as const,
  savingsByMember: (id: ID) => ["savings", "member", id] as const,
  loans: ["loans"] as const,
  loansByMember: (id: ID) => ["loans", "member", id] as const,
  loan: (id: ID) => ["loans", id] as const,
  repayments: ["repayments"] as const,
  charges: ["charges"] as const,
  guarantors: ["guarantors"] as const,
  pendingGuarantorRequests: (id: ID) => ["guarantors", "pending", id] as const,
  earlyRepayments: ["earlyRepayments"] as const,
  subscriptions: ["subscriptions"] as const,
  expenses: ["expenses"] as const,
  unitTrust: ["unitTrust"] as const,
  documents: ["documents"] as const,
  documentCategories: ["documents", "categories"] as const,
  ledger: ["reports", "ledger"] as const,
  interestMonthly: ["reports", "interestMonthly"] as const,
  retainedEarnings: ["reports", "retainedEarnings"] as const,
  financialConfig: ["financialConfig"] as const,
};

export const useMembers = () => useQuery({ queryKey: queryKeys.members, queryFn: () => membersService.list() });
export const useMember = (id?: ID) =>
  useQuery({ queryKey: queryKeys.member(id ?? ""), queryFn: () => membersService.get(id!), enabled: !!id });

export const useSavings = () => useQuery({ queryKey: queryKeys.savings, queryFn: () => savingsService.list() });
export const useSavingsByMember = (id?: ID) =>
  useQuery({ queryKey: queryKeys.savingsByMember(id ?? ""), queryFn: () => savingsService.byMember(id!), enabled: !!id });

export const useLoans = () => useQuery({ queryKey: queryKeys.loans, queryFn: () => loansService.list() });
export const useLoansByMember = (id?: ID) =>
  useQuery({ queryKey: queryKeys.loansByMember(id ?? ""), queryFn: () => loansService.byMember(id!), enabled: !!id });
export const useLoan = (id?: ID) =>
  useQuery({ queryKey: queryKeys.loan(id ?? ""), queryFn: () => loansService.get(id!), enabled: !!id });

export const useLoanRepayments = () =>
  useQuery({ queryKey: queryKeys.repayments, queryFn: () => loanRepaymentsService.list() });
export const useLoanCharges = () =>
  useQuery({ queryKey: queryKeys.charges, queryFn: () => loanChargesService.list() });

export const useLoanGuarantors = () =>
  useQuery({ queryKey: queryKeys.guarantors, queryFn: () => loanGuarantorsService.list() });
export const usePendingGuarantorRequests = (memberId?: ID) =>
  useQuery({
    queryKey: queryKeys.pendingGuarantorRequests(memberId ?? ""),
    queryFn: () => loanGuarantorsService.pendingForGuarantor(memberId!),
    enabled: !!memberId,
  });

export const useEarlyRepayments = () =>
  useQuery({ queryKey: queryKeys.earlyRepayments, queryFn: () => earlyRepaymentService.list() });

export const useSubscriptions = () =>
  useQuery({ queryKey: queryKeys.subscriptions, queryFn: () => subscriptionsService.list() });
export const useExpenses = () =>
  useQuery({ queryKey: queryKeys.expenses, queryFn: () => expensesService.list() });
export const useUnitTrust = () =>
  useQuery({ queryKey: queryKeys.unitTrust, queryFn: () => unitTrustService.list() });

export const useDocuments = () =>
  useQuery({ queryKey: queryKeys.documents, queryFn: () => documentsService.list() });
export const useDocumentCategories = () =>
  useQuery({ queryKey: queryKeys.documentCategories, queryFn: () => documentsService.categories() });

export const useLedger = () =>
  useQuery({ queryKey: queryKeys.ledger, queryFn: () => reportsService.ledger() });
export const useInterestMonthly = () =>
  useQuery({ queryKey: queryKeys.interestMonthly, queryFn: () => reportsService.interestMonthly() });
export const useRetainedEarnings = () =>
  useQuery({ queryKey: queryKeys.retainedEarnings, queryFn: () => reportsService.retainedEarnings() });

export const useFinancialConfig = () =>
  useQuery({ queryKey: queryKeys.financialConfig, queryFn: () => financialConfigService.get() });
