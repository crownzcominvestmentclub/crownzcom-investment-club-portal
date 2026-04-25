// Rich seed data for previewing UI before Convex is wired.
// Shape mirrors src/lib/types.ts and is structured for direct insertion into Convex tables.

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
} from "@/lib/types";

const now = new Date();
const iso = (d: Date) => d.toISOString();
const monthsAgo = (n: number) => {
  const d = new Date(now);
  d.setMonth(d.getMonth() - n);
  return d;
};
const monthKey = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;

const NAMES = [
  "Aisha Namatovu", "Brian Okello", "Catherine Akello", "David Mugisha", "Esther Nakato",
  "Frank Tumwine", "Grace Nansubuga", "Henry Lubega", "Irene Kabugho", "James Ssemambo",
  "Kelvin Wasswa", "Lillian Atim", "Moses Kintu", "Nakimuli Joan", "Owen Mukasa",
  "Patricia Nabirye", "Quentin Otim", "Rose Nankya", "Samuel Kato", "Teddy Nansereko",
  "Umar Ssali", "Vivian Auma", "Wycliffe Bukenya", "Xavier Lugya",
];

export const seedFinancialConfig: FinancialConfig = {
  id: "cfg_default",
  loanInterestRate: 3,
  longTermInterestRate: 2.5,
  interestCalculationMode: "reducing_balance",
  loanEligibilityPercentage: 200,
  defaultBankCharge: 5000,
  earlyRepaymentPenalty: 2,
  maxLoanDuration: 6,
  longTermMaxRepaymentMonths: 24,
  minLoanAmount: 100_000,
  maxLoanAmount: 50_000_000,
};

export const seedMembers: Member[] = NAMES.map((name, idx) => {
  const i = idx + 1;
  const joinMonths = 24 + Math.floor(Math.random() * 36);
  return {
    id: `mem_${String(i).padStart(3, "0")}`,
    name,
    email: name.toLowerCase().replace(/[^a-z]+/g, ".") + "@crownzcom.ug",
    phone: `+25670${String(1000000 + i * 7919).slice(-7)}`,
    membershipNumber: `CIC-${String(1000 + i)}`,
    authUserId: `auth_${i}`,
    joinDate: iso(monthsAgo(joinMonths)),
    status: i % 17 === 0 ? "inactive" : "active",
  };
});

// Savings: ~12 months per member, varying amounts
export const seedSavings: Savings[] = (() => {
  const arr: Savings[] = [];
  let counter = 1;
  for (const m of seedMembers) {
    const months = 8 + Math.floor(Math.random() * 16);
    for (let i = 0; i < months; i++) {
      const d = monthsAgo(i);
      arr.push({
        id: `sav_${counter++}`,
        memberId: m.id,
        amount: [50_000, 100_000, 150_000, 200_000, 250_000, 300_000][Math.floor(Math.random() * 6)],
        month: monthKey(d),
        createdAt: iso(d),
      });
    }
  }
  return arr;
})();

// Subscriptions: annual
export const seedSubscriptions: Subscription[] = seedMembers.flatMap((m, idx) => [
  {
    id: `sub_${idx}_2025`,
    memberId: m.id,
    amount: 50_000,
    month: "2025-01",
    createdAt: iso(new Date(2025, 0, 15)),
  },
  ...(idx % 3 !== 0
    ? [{
        id: `sub_${idx}_2024`,
        memberId: m.id,
        amount: 50_000,
        month: "2024-01",
        createdAt: iso(new Date(2024, 0, 15)),
      } as Subscription]
    : []),
]);

// Loans — mix of statuses, types, and guarantor situations
const loanTemplates: Array<Partial<Loan> & { memberIdx: number }> = [
  { memberIdx: 0, amount: 2_000_000, duration: 6, loanType: "short_term", status: "active", balance: 800_000 },
  { memberIdx: 1, amount: 8_000_000, duration: 18, loanType: "long_term", status: "active", balance: 5_400_000, guarantorRequired: true },
  { memberIdx: 2, amount: 1_500_000, duration: 4, loanType: "short_term", status: "completed", balance: 0 },
  { memberIdx: 3, amount: 12_000_000, duration: 24, loanType: "long_term", status: "pending_admin_approval", balance: 12_000_000, guarantorRequired: true },
  { memberIdx: 4, amount: 5_000_000, duration: 12, loanType: "long_term", status: "pending_guarantor_approval", balance: 5_000_000, guarantorRequired: true },
  { memberIdx: 5, amount: 800_000, duration: 3, loanType: "short_term", status: "active", balance: 300_000 },
  { memberIdx: 6, amount: 3_000_000, duration: 6, loanType: "short_term", status: "rejected", balance: 0 },
  { memberIdx: 7, amount: 15_000_000, duration: 24, loanType: "long_term", status: "guarantor_coverage_failed", balance: 0, guarantorRequired: true },
  { memberIdx: 8, amount: 2_500_000, duration: 6, loanType: "short_term", status: "active", balance: 1_700_000 },
  { memberIdx: 9, amount: 6_000_000, duration: 12, loanType: "long_term", status: "active", balance: 4_200_000, guarantorRequired: true },
  { memberIdx: 10, amount: 1_200_000, duration: 4, loanType: "short_term", status: "completed", balance: 0 },
  { memberIdx: 11, amount: 9_500_000, duration: 18, loanType: "long_term", status: "active", balance: 7_100_000, guarantorRequired: true },
  { memberIdx: 12, amount: 500_000, duration: 2, loanType: "short_term", status: "active", balance: 250_000 },
  { memberIdx: 13, amount: 4_000_000, duration: 8, loanType: "short_term", status: "pending_admin_approval", balance: 4_000_000 },
];

export const seedLoans: Loan[] = loanTemplates.map((t, i) => {
  const member = seedMembers[t.memberIdx];
  const createdAt = iso(monthsAgo(t.duration ? t.duration - 2 : 3));
  const isLong = t.loanType === "long_term";
  return {
    id: `loan_${String(i + 1).padStart(3, "0")}`,
    memberId: member.id,
    amount: t.amount!,
    duration: t.duration!,
    loanType: t.loanType!,
    termsAccepted: true,
    purpose: ["Business expansion", "School fees", "Home renovation", "Medical", "Land purchase"][i % 5],
    repaymentType: i % 4 === 0 ? "custom" : "equal_installments",
    interestCalculationModeApplied: isLong ? "reducing_balance" : "flat",
    monthlyInterestRateApplied: isLong ? 2.5 : 3,
    status: t.status!,
    createdAt,
    approvedAt: ["active", "completed"].includes(t.status!) ? createdAt : undefined,
    rejectedAt: t.status === "rejected" ? createdAt : undefined,
    balance: t.balance!,
    guarantorRequired: !!t.guarantorRequired,
    borrowerCoverage: t.guarantorRequired ? Math.round(t.amount! * 0.6) : t.amount!,
    guarantorGapAmount: t.guarantorRequired ? Math.round(t.amount! * 0.4) : 0,
    guarantorRequestedAmount: t.guarantorRequired ? Math.round(t.amount! * 0.4) : 0,
    guarantorApprovedAmount: t.guarantorRequired && ["active", "completed"].includes(t.status!) ? Math.round(t.amount! * 0.4) : 0,
    guarantorApprovalStatus: t.guarantorRequired
      ? t.status === "pending_guarantor_approval"
        ? "pending"
        : t.status === "guarantor_coverage_failed"
          ? "failed"
          : "complete"
      : undefined,
  };
});

export const seedLoanRepayments: LoanRepayment[] = seedLoans.flatMap((loan) => {
  if (!["active", "completed"].includes(loan.status)) return [];
  const paidCount = loan.status === "completed" ? loan.duration : Math.max(1, Math.floor(loan.duration / 2));
  const installment = Math.round(loan.amount / loan.duration);
  return Array.from({ length: paidCount }).map((_, i) => ({
    id: `rep_${loan.id}_${i + 1}`,
    loanId: loan.id,
    amount: installment,
    month: monthKey(monthsAgo(paidCount - i)),
    paidAt: iso(monthsAgo(paidCount - i)),
  }));
});

export const seedLoanCharges: LoanCharge[] = seedLoans.slice(0, 8).map((loan, i) => ({
  id: `chg_${i + 1}`,
  loanId: loan.id,
  description: i % 2 === 0 ? "Processing fee" : "Bank charge",
  amount: 5_000,
  createdAt: loan.createdAt,
}));

// Guarantor requests for long-term loans that required guarantors
export const seedLoanGuarantors: LoanGuarantor[] = (() => {
  const arr: LoanGuarantor[] = [];
  let counter = 1;
  seedLoans.filter((l) => l.guarantorRequired).forEach((loan, idx) => {
    // pick 2 guarantors from other members
    const guarantors = seedMembers.filter((m) => m.id !== loan.memberId).slice(idx * 2, idx * 2 + 2);
    guarantors.forEach((g, gi) => {
      const status: LoanGuarantor["status"] =
        loan.status === "pending_guarantor_approval"
          ? gi === 0 ? "approved" : "pending"
          : loan.status === "guarantor_coverage_failed"
            ? "declined"
            : loan.status === "completed"
              ? "released"
              : "approved";
      arr.push({
        id: `gua_${counter++}`,
        loanId: loan.id,
        borrowerId: loan.memberId,
        guarantorId: g.id,
        guaranteeType: "amount",
        guaranteedAmount: Math.round((loan.guarantorRequestedAmount ?? 0) / 2),
        approvedAmount: status === "approved" || status === "released" ? Math.round((loan.guarantorRequestedAmount ?? 0) / 2) : 0,
        securedOutstanding: status === "approved" ? Math.round((loan.balance ?? 0) / 2) : 0,
        status,
        comment: status === "declined" ? "Currently overcommitted on other guarantees" : undefined,
        requestedAt: loan.createdAt,
        respondedAt: status !== "pending" ? loan.createdAt : undefined,
        approvedAt: status === "approved" || status === "released" ? loan.createdAt : undefined,
        declinedAt: status === "declined" ? loan.createdAt : undefined,
        releasedAt: status === "released" ? loan.createdAt : undefined,
        createdAt: loan.createdAt,
        updatedAt: loan.createdAt,
      });
    });
  });
  return arr;
})();

export const seedEarlyRepaymentRequests: LoanEarlyRepaymentRequest[] = seedLoans
  .filter((l) => l.status === "active")
  .slice(0, 3)
  .map((loan, i) => ({
    id: `erp_${i + 1}`,
    loanId: loan.id,
    memberId: loan.memberId,
    status: ["pending", "approved", "paid"][i] as LoanEarlyRepaymentRequest["status"],
    month: monthKey(now),
    amount: loan.balance,
    interestCalculationModeApplied: loan.interestCalculationModeApplied,
    monthlyInterestRateApplied: loan.monthlyInterestRateApplied,
    penaltyRateApplied: 2,
    interestAmount: Math.round(loan.balance * 0.025),
    principalAmount: loan.balance,
    chargeAmount: 5_000,
    balanceAtRequest: loan.balance,
    requestedAt: iso(monthsAgo(0)),
  }));

export const seedExpenses: Expense[] = [
  { id: "exp_1", description: "Mobile money charges", amount: 45_000, category: "Banking", date: iso(monthsAgo(1)), createdAt: iso(monthsAgo(1)) },
  { id: "exp_2", description: "AGM venue & catering", amount: 1_200_000, category: "Events", date: iso(monthsAgo(3)), createdAt: iso(monthsAgo(3)) },
  { id: "exp_3", description: "Stationery & printing", amount: 180_000, category: "Operations", date: iso(monthsAgo(2)), createdAt: iso(monthsAgo(2)) },
  { id: "exp_4", description: "Cloud hosting", amount: 320_000, category: "Technology", date: iso(monthsAgo(0)), createdAt: iso(monthsAgo(0)) },
  { id: "exp_5", description: "Auditor fees", amount: 800_000, category: "Professional", date: iso(monthsAgo(4)), createdAt: iso(monthsAgo(4)) },
];

export const seedUnitTrust: UnitTrust[] = [
  { id: "ut_1", type: "deposit", amount: 20_000_000, description: "Q1 placement", date: iso(monthsAgo(6)), createdAt: iso(monthsAgo(6)) },
  { id: "ut_2", type: "interest", amount: 480_000, description: "Q1 interest", date: iso(monthsAgo(3)), createdAt: iso(monthsAgo(3)) },
  { id: "ut_3", type: "deposit", amount: 10_000_000, description: "Top-up", date: iso(monthsAgo(2)), createdAt: iso(monthsAgo(2)) },
  { id: "ut_4", type: "interest", amount: 320_000, description: "Q2 interest", date: iso(monthsAgo(0)), createdAt: iso(monthsAgo(0)) },
];

export const seedLedger: LedgerEntry[] = [
  ...seedSavings.slice(0, 30).map((s, i) => ({
    id: `led_s_${i}`,
    type: "savings_deposit",
    amount: s.amount,
    memberId: s.memberId,
    month: s.month,
    year: Number(s.month.split("-")[0]),
    createdAt: s.createdAt,
  })),
  ...seedExpenses.map((e, i) => ({
    id: `led_e_${i}`,
    type: "expense",
    amount: -e.amount,
    month: e.date.slice(0, 7),
    year: new Date(e.date).getFullYear(),
    createdAt: e.createdAt,
    notes: e.description,
  })),
];

export const seedInterestMonthly: InterestMonthly[] = [-5, -4, -3, -2, -1, 0].map((m, i) => {
  const d = monthsAgo(-m);
  return {
    id: `int_${i}`,
    month: monthKey(d),
    year: d.getFullYear(),
    loanInterestTotal: 350_000 + i * 25_000,
    trustInterestTotal: 120_000 + i * 10_000,
    createdAt: iso(d),
  };
});

export const seedRetainedEarnings: RetainedEarnings[] = [
  { id: "re_2024", year: 2024, percentage: 20, createdAt: iso(new Date(2024, 11, 31)) },
  { id: "re_2023", year: 2023, percentage: 25, createdAt: iso(new Date(2023, 11, 31)) },
];

export const seedDocumentCategories: DocumentCategory[] = [
  { id: "dc_1", name: "AGM Reports", description: "Annual general meeting minutes & resolutions", createdAt: iso(monthsAgo(24)), updatedAt: iso(monthsAgo(2)) },
  { id: "dc_2", name: "Financial Statements", description: "Audited and management accounts", createdAt: iso(monthsAgo(24)), updatedAt: iso(monthsAgo(2)) },
  { id: "dc_3", name: "Policies", description: "Constitution, lending policy, governance", createdAt: iso(monthsAgo(24)), updatedAt: iso(monthsAgo(6)) },
  { id: "dc_4", name: "Member Statements", description: "Per-member statements", createdAt: iso(monthsAgo(24)), updatedAt: iso(monthsAgo(1)) },
];

export const seedDocuments: DocumentRecord[] = [
  { id: "doc_1", title: "AGM Minutes 2024", category: "AGM Reports", fileId: "f_1", bucketId: "b_1", uploadedBy: seedMembers[0].id, uploadedAt: iso(monthsAgo(2)), tags: ["agm", "2024"], period: "2024" },
  { id: "doc_2", title: "Audited Financials 2024", category: "Financial Statements", fileId: "f_2", bucketId: "b_1", uploadedBy: seedMembers[0].id, uploadedAt: iso(monthsAgo(2)), tags: ["audit", "2024"], period: "2024" },
  { id: "doc_3", title: "Lending Policy v3", category: "Policies", fileId: "f_3", bucketId: "b_1", uploadedBy: seedMembers[0].id, uploadedAt: iso(monthsAgo(6)), tags: ["policy"] },
];

// Seed auth users — one admin, one dual-role, several pure members
export const seedAuthUsers: AuthUser[] = [
  { id: "auth_admin", email: "admin@crownzcom.ug", name: "System Administrator", roles: ["admin"] },
  { id: "auth_dual", email: seedMembers[0].email, name: seedMembers[0].name, memberId: seedMembers[0].id, roles: ["admin", "member"] },
  ...seedMembers.slice(1, 6).map((m) => ({
    id: `auth_${m.id}`,
    email: m.email,
    name: m.name,
    memberId: m.id,
    roles: ["member"] as AuthUser["roles"],
  })),
];
