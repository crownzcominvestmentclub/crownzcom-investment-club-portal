// Shared financial calculation utilities
// Centralizes member financial metrics used across admin and member pages

import type { Savings, Loan, Member, Subscription, FinancialConfig } from "@/lib/types";

/**
 * Calculate total savings for a member
 */
export function calculateTotalSavings(savings: Savings[]): number {
  return savings.reduce((total, s) => total + s.amount, 0);
}

/**
 * Calculate loan eligibility based on savings and config
 */
export function calculateLoanEligibility(
  totalSavings: number,
  config: FinancialConfig | undefined
): number {
  if (!config) return 0;
  return Math.round((totalSavings * config.loanEligibilityPercentage) / 100);
}

/**
 * Calculate outstanding loan balance for a member
 */
export function calculateOutstandingLoans(loans: Loan[]): number {
  return loans
    .filter((loan) => loan.status === "active")
    .reduce((total, loan) => total + (loan.balance ?? 0), 0);
}

/**
 * Calculate available credit for a member
 */
export function calculateAvailableCredit(
  totalSavings: number,
  outstanding: number,
  config: FinancialConfig | undefined
): number {
  const eligibility = calculateLoanEligibility(totalSavings, config);
  return Math.max(0, eligibility - outstanding);
}

/**
 * Get active loan count for a member
 */
export function getActiveLoanCount(loans: Loan[]): number {
  return loans.filter((loan) => loan.status === "active").length;
}

/**
 * Calculate subscription outstanding for a year
 * Formula: (active members * subscription amount) - collected (only paid subscriptions)
 */
export function calculateSubscriptionOutstanding(
  members: Member[],
  subscriptions: Subscription[],
  subscriptionAmount: number = 50000,
  year: string
): number {
  const activeMembers = members.filter((m) => m.status === "active").length;
  const expected = activeMembers * subscriptionAmount;

  const yearSubs = subscriptions.filter((s) => String(s.month).startsWith(`${year}-`));
  const collected = yearSubs
    .filter((s) => (s.status ?? "paid") === "paid")
    .reduce((total, s) => total + s.amount, 0);

  return Math.max(0, expected - collected);
}

export function getSubscriptionOutstandingBreakdown(
  members: Member[],
  subscriptions: Subscription[],
  subscriptionAmount: number = 50000,
  year: string
) {
  const activeMemberCount = members.filter((member) => member.status === "active").length;
  const expected = activeMemberCount * subscriptionAmount;
  const collected = subscriptions
    .filter((subscription) => String(subscription.month).startsWith(`${year}-`))
    .filter((subscription) => (subscription.status ?? "paid") === "paid")
    .reduce((total, subscription) => total + subscription.amount, 0);

  return {
    activeMemberCount,
    subscriptionAmount,
    expected,
    collected,
    outstanding: Math.max(0, expected - collected),
  };
}

/**
 * Get member financial summary
 */
export interface MemberFinancialSummary {
  totalSavings: number;
  loanEligibility: number;
  outstandingLoans: number;
  availableCredit: number;
  activeLoanCount: number;
}

export function getMemberFinancialSummary(
  savings: Savings[],
  loans: Loan[],
  config: FinancialConfig | undefined
): MemberFinancialSummary {
  const totalSavings = calculateTotalSavings(savings);
  const outstandingLoans = calculateOutstandingLoans(loans);
  const loanEligibility = calculateLoanEligibility(totalSavings, config);
  const availableCredit = calculateAvailableCredit(totalSavings, outstandingLoans, config);
  const activeLoanCount = getActiveLoanCount(loans);

  return {
    totalSavings,
    loanEligibility,
    outstandingLoans,
    availableCredit,
    activeLoanCount,
  };
}

/**
 * Get total savings for a specific member from all savings data
 */
export function getMemberTotalSavings(memberId: string, allSavings: Savings[]): number {
  const memberSavings = allSavings.filter((s) => s.memberId === memberId);
  return calculateTotalSavings(memberSavings);
}

/**
 * Get outstanding loans for a specific member from all loans data
 */
export function getMemberOutstandingLoans(memberId: string, allLoans: Loan[]): number {
  const memberLoans = allLoans.filter((l) => l.memberId === memberId);
  return calculateOutstandingLoans(memberLoans);
}

/**
 * Get active loan count for a specific member from all loans data
 */
export function getMemberActiveLoanCount(memberId: string, allLoans: Loan[]): number {
  const memberLoans = allLoans.filter((l) => l.memberId === memberId);
  return getActiveLoanCount(memberLoans);
}
