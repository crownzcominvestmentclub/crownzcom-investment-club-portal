import { describe, expect, it } from "vitest";
import {
  buildScheduleRows,
  calculateRepaymentStatus,
  getEarlyRepaymentsForLoan,
  groupLoanCharges,
  validateRepaymentAmount,
} from "@/lib/repayment";
import type { Loan, LoanCharge, LoanRepayment } from "@/lib/types";

const baseLoan: Loan = {
  id: "loan_1",
  memberId: "member_1",
  amount: 300000,
  duration: 3,
  loanType: "short_term",
  termsAccepted: true,
  repaymentType: "equal_installments",
  repaymentPlan: [
    { month: "2026-01", principal: 100000, interest: 10000, total: 110000, balance: 200000, status: "pending" },
    { month: "2026-02", principal: 100000, interest: 7000, total: 107000, balance: 100000, status: "pending" },
    { month: "2026-03", principal: 100000, interest: 3000, total: 103000, balance: 0, status: "pending" },
  ],
  interestCalculationModeApplied: "flat",
  monthlyInterestRateApplied: 3,
  status: "active",
  createdAt: "2025-12-20T00:00:00.000Z",
  balance: 200000,
  guarantorRequired: false,
};

describe("calculateRepaymentStatus", () => {
  it("returns pending when unpaid month has not ended", () => {
    expect(calculateRepaymentStatus("2026-02", null, Date.UTC(2026, 1, 10))).toBe("pending");
  });

  it("returns late when unpaid month has passed", () => {
    expect(calculateRepaymentStatus("2026-02", null, Date.UTC(2026, 2, 5))).toBe("late");
  });

  it("returns early when payment lands before the scheduled month", () => {
    expect(calculateRepaymentStatus("2026-02", Date.UTC(2026, 0, 29))).toBe("early");
  });

  it("returns paid when payment lands within the scheduled month", () => {
    expect(calculateRepaymentStatus("2026-02", Date.UTC(2026, 1, 15))).toBe("paid");
  });
});

describe("buildScheduleRows", () => {
  it("applies actual paid dates and statuses onto schedule rows", () => {
    const repayments: LoanRepayment[] = [
      {
        id: "rep_1",
        loanId: "loan_1",
        month: "2026-01",
        amount: 110000,
        paidAt: "2026-01-12T00:00:00.000Z",
        paymentStatus: "paid",
      },
    ];

    const rows = buildScheduleRows(baseLoan, repayments);
    expect(rows[0]).toMatchObject({
      month: "2026-01",
      status: "paid",
      paidAt: "2026-01-12T00:00:00.000Z",
      paymentId: "rep_1",
    });
    expect(rows[1].status).toBe("pending");
  });
});

describe("getEarlyRepaymentsForLoan", () => {
  it("separates early-payment records from the normal schedule trail", () => {
    const repayments: LoanRepayment[] = [
      {
        id: "rep_1",
        loanId: "loan_1",
        month: "2026-01",
        amount: 20000,
        paidAt: "2025-12-29T00:00:00.000Z",
        isEarlyPayment: true,
        paymentStatus: "early",
      },
      {
        id: "rep_2",
        loanId: "loan_1",
        month: "2026-01",
        amount: 90000,
        paidAt: "2026-01-15T00:00:00.000Z",
        paymentStatus: "paid",
      },
    ];

    expect(getEarlyRepaymentsForLoan("loan_1", repayments).map((item) => item.id)).toEqual(["rep_1"]);
  });
});

describe("validateRepaymentAmount", () => {
  it("blocks zero and excessive repayments", () => {
    expect(validateRepaymentAmount(0, 1000)).toContain("valid");
    expect(validateRepaymentAmount(1500, 1000)).toContain("exceeds");
    expect(validateRepaymentAmount(1000, 1000)).toBeNull();
  });
});

describe("groupLoanCharges", () => {
  it("groups general and first-month charges separately", () => {
    const charges: LoanCharge[] = [
      {
        id: "chg_1",
        loanId: "loan_1",
        description: "Processing fee",
        amount: 5000,
        kind: "processing_fee",
        appliesToMonth: "2026-01",
        createdAt: "2026-01-01T00:00:00.000Z",
      },
      {
        id: "chg_2",
        loanId: "loan_1",
        description: "Manual adjustment",
        amount: 2000,
        kind: "other",
        createdAt: "2026-01-02T00:00:00.000Z",
      },
    ];

    const groups = groupLoanCharges(charges, baseLoan);
    expect(groups).toHaveLength(2);
    expect(groups[0].label).toBe("First scheduled month (Jan 2026)");
    expect(groups[1].label).toBe("General charges");
  });
});
