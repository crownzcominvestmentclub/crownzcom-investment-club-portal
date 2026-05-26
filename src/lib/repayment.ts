import { formatMonth } from "@/lib/format";
import type { Loan, LoanCharge, LoanRepayment, RepaymentStatus } from "@/lib/types";

export type ScheduleViewRow = {
  month: string;
  total: number;
  principal: number;
  interest: number;
  balance: number;
  status: RepaymentStatus;
  paidAt?: string;
  paymentId?: string;
};

export function toTimestamp(input: string) {
  if (!input) return null;
  const date = new Date(`${input}T00:00:00`);
  const timestamp = date.getTime();
  return Number.isFinite(timestamp) ? timestamp : null;
}

export function calculateRepaymentStatus(
  month: string,
  paidAt: number | string | Date | null | undefined,
  nowMs = Date.now(),
): RepaymentStatus {
  const [year, monthNum] = month.split("-").map(Number);
  const startMs = Date.UTC(year, monthNum - 1, 1, 0, 0, 0, 0);
  const endMs = Date.UTC(year, monthNum, 0, 23, 59, 59, 999);
  const paidAtMs =
    paidAt instanceof Date
      ? paidAt.getTime()
      : typeof paidAt === "string"
      ? new Date(paidAt).getTime()
      : typeof paidAt === "number"
      ? paidAt
      : null;

  if (paidAtMs === null || Number.isNaN(paidAtMs)) {
    return nowMs > endMs ? "late" : "pending";
  }
  if (paidAtMs < startMs) return "early";
  if (paidAtMs > endMs) return "late";
  return "paid";
}

export function buildScheduleRows(loan: Loan, repayments: LoanRepayment[]): ScheduleViewRow[] {
  const repaymentByMonth = new Map<string, LoanRepayment[]>();
  repayments
    .filter((repayment) => repayment.loanId === loan.id && !repayment.isEarlyPayment)
    .forEach((repayment) => {
      const current = repaymentByMonth.get(repayment.month) ?? [];
      current.push(repayment);
      repaymentByMonth.set(repayment.month, current);
    });

  return (loan.repaymentPlan ?? []).map((item) => {
    const matched = (repaymentByMonth.get(item.month) ?? []).sort((a, b) => String(a.paidAt).localeCompare(String(b.paidAt)))[0];
    return {
      month: item.month,
      total: item.total,
      principal: item.principal,
      interest: item.interest,
      balance: item.balance,
      status: matched?.paymentStatus ?? item.status,
      paidAt: matched?.paidAt ?? item.paidAt,
      paymentId: matched?.id ?? item.paymentId,
    };
  });
}

export function getEarlyRepaymentsForLoan(loanId: string, repayments: LoanRepayment[]) {
  return repayments
    .filter((repayment) => repayment.loanId === loanId)
    .filter((repayment) => repayment.isEarlyPayment || repayment.paymentStatus === "early");
}

export function validateRepaymentAmount(amount: number, scheduledAmount: number) {
  if (!Number.isFinite(amount) || amount <= 0) return "Enter a valid repayment amount.";
  if (amount > scheduledAmount) return `Repayment exceeds the scheduled amount of ${scheduledAmount}.`;
  return null;
}

export function groupLoanCharges(charges: LoanCharge[], loan: Loan) {
  const firstMonth = loan.repaymentPlan?.[0]?.month;
  const grouped = new Map<string, { key: string; label: string; charges: LoanCharge[] }>();

  charges.forEach((charge) => {
    const key = charge.appliesToMonth ?? "general";
    let label = "General charges";
    if (charge.appliesToMonth) {
      label = charge.appliesToMonth === firstMonth
        ? `First scheduled month (${formatMonth(charge.appliesToMonth)})`
        : formatMonth(charge.appliesToMonth);
    }

    const current = grouped.get(key) ?? { key, label, charges: [] };
    current.charges.push(charge);
    grouped.set(key, current);
  });

  return Array.from(grouped.values()).sort((a, b) => a.key.localeCompare(b.key));
}
