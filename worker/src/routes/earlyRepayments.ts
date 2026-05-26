import { Hono } from "hono";
import { z } from "zod";
import type { AppContext } from "../middleware";
import { apiError, requireAuth, requireRole } from "../middleware";
import { all, newId, nowMs, one } from "../db";
import {
  allocateRepayment,
  buildRepaymentStatements,
  getChargesByLoanIds,
  getRepaymentsByLoanIds,
  getValidatedRepaymentStatus,
  parseLoan,
  type LoanChargeRow,
  type LoanRepaymentRow,
  type RepaymentPostingLoan,
} from "./loans";

export const earlyRepayments = new Hono<AppContext>();

const SELECT =
  "SELECT id, loan_id AS loanId, member_id AS memberId, status, amount, requested_at AS requestedAt, resolved_at AS resolvedAt, interest_calculation_mode AS interestCalculationModeApplied, monthly_interest_rate AS monthlyInterestRateApplied, penalty_rate AS penaltyRateApplied, interest_amount AS interestAmount, principal_amount AS principalAmount, charge_amount AS chargeAmount, balance_at_request AS balanceAtRequest, requested_for_date AS requestedForDate, paid_at AS paidAt, admin_comment AS adminComment FROM early_repayment_requests";

const RequestSchema = z.object({
  loanId: z.string(),
  requestedForDate: z.number().optional(),
});

const DecisionSchema = z.object({
  adminComment: z.string().optional(),
});

const MarkPaidSchema = z.object({
  paidAt: z.number().optional(),
  adminComment: z.string().optional(),
});

earlyRepayments.get("/", requireAuth, requireRole("admin"), async (c) => {
  const rows = await all(c.env.DB.prepare(`${SELECT} ORDER BY requested_at DESC`));
  return c.json(rows);
});

earlyRepayments.post("/", requireAuth, async (c) => {
  const parsed = RequestSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return apiError(c, 400, "invalid_input", "Invalid payload", parsed.error.flatten());

  const user = c.get("user")!;
  if (!user.memberId) return apiError(c, 400, "member_profile_required", "Your account is not linked to a member profile");

  const loan = await one<{ id: string; memberId: string; status: string } & Record<string, unknown>>(
    c.env.DB.prepare(
      "SELECT id, member_id AS memberId, type, principal, interest_rate_pct AS interestRatePct, term_months AS termMonths, purpose, status, outstanding, applied_at AS appliedAt, approved_at AS approvedAt, repayment_plan AS repaymentPlan, repayment_start_month AS repaymentStartMonth, first_repayment_date AS firstRepaymentDate, repayment_day_of_month AS repaymentDayOfMonth, repayment_plan_version AS repaymentPlanVersion, repayment_plan_generated_at AS repaymentPlanGeneratedAt, repayment_plan_basis AS repaymentPlanBasis FROM loans WHERE id = ?",
    ).bind(parsed.data.loanId),
  );
  if (!loan) return apiError(c, 404, "not_found", "Loan not found");
  if (loan.memberId !== user.memberId && !user.roles.includes("admin")) {
    return apiError(c, 403, "forbidden", "You can only request early repayment for your own loan");
  }
  if (loan.status !== "active") {
    return apiError(c, 400, "invalid_loan_status", "Only active loans can receive an early repayment request");
  }

  const existingOpen = await one<{ id: string }>(
    c.env.DB.prepare(
      "SELECT id FROM early_repayment_requests WHERE loan_id = ? AND status IN ('pending','approved') ORDER BY requested_at DESC LIMIT 1",
    ).bind(loan.id),
  );
  if (existingOpen) {
    return apiError(c, 409, "open_request_exists", "There is already an open early repayment request for this loan");
  }

  const repaymentsByLoanId = await getRepaymentsByLoanIds(c.env.DB, [loan.id]);
  const chargesByLoanId = await getChargesByLoanIds(c.env.DB, [loan.id]);
  const parsedLoan = parseLoan(loan, repaymentsByLoanId.get(loan.id) ?? [], chargesByLoanId.get(loan.id) ?? []);
  const remainingRows = (parsedLoan.repaymentPlan ?? []).filter((row: any) => row.status === "pending" || row.status === "late");
  if (remainingRows.length === 0) {
    return apiError(c, 400, "no_remaining_schedule", "This loan has no remaining unpaid installments");
  }

  const cfg = await one<{ earlyRepaymentPenalty: number }>(
    c.env.DB.prepare("SELECT early_repayment_penalty AS earlyRepaymentPenalty FROM financial_config WHERE id = 1"),
  );
  const penaltyRate = Number(cfg?.earlyRepaymentPenalty ?? 0) || 0;
  const principalAmount = remainingRows.reduce((sum: number, row: any) => sum + (Number(row.principal) || 0), 0);
  const interestAmount = remainingRows.reduce((sum: number, row: any) => sum + (Number(row.interest) || 0), 0);
  const scheduledCharges = remainingRows.reduce((sum: number, row: any) => sum + (Number(row.chargeAmount) || 0), 0);
  const outstandingBalance = Number((parsedLoan as any).outstanding ?? 0) || 0;
  const penaltyAmount = Math.round((outstandingBalance * penaltyRate) / 100);
  const chargeAmount = scheduledCharges + penaltyAmount;
  const amount = principalAmount + interestAmount + chargeAmount;
  const id = newId("erp");

  await c.env.DB.prepare(
    "INSERT INTO early_repayment_requests (id, loan_id, member_id, amount, status, requested_at, interest_calculation_mode, monthly_interest_rate, penalty_rate, interest_amount, principal_amount, charge_amount, balance_at_request, requested_for_date, admin_comment) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
  ).bind(
    id,
    loan.id,
    loan.memberId,
    amount,
    "pending",
    nowMs(),
    (parsedLoan as any).interestCalculationModeApplied ?? "flat",
    Number((parsedLoan as any).monthlyInterestRateApplied ?? (loan as any).interestRatePct ?? 0) || 0,
    penaltyRate,
    interestAmount,
    principalAmount,
    chargeAmount,
    outstandingBalance,
    parsed.data.requestedForDate ?? null,
    null,
  ).run();

  const row = await one(c.env.DB.prepare(`${SELECT} WHERE id = ?`).bind(id));
  return c.json(row, 201);
});

earlyRepayments.post("/:id/cancel", requireAuth, async (c) => {
  const user = c.get("user")!;
  const request = await one<{ id: string; memberId: string; status: string }>(
    c.env.DB.prepare(`${SELECT} WHERE id = ?`).bind(c.req.param("id")),
  );
  if (!request) return apiError(c, 404, "not_found", "Early repayment request not found");
  if (request.memberId !== user.memberId && !user.roles.includes("admin")) {
    return apiError(c, 403, "forbidden", "You can only cancel your own early repayment request");
  }
  if (request.status !== "pending") {
    return apiError(c, 400, "invalid_status", "Only pending requests can be cancelled");
  }

  await c.env.DB.prepare(
    "UPDATE early_repayment_requests SET status = 'cancelled', resolved_at = ? WHERE id = ?",
  ).bind(nowMs(), request.id).run();
  return c.body(null, 204);
});

earlyRepayments.post("/:id/approve", requireAuth, requireRole("admin"), async (c) => {
  const parsed = DecisionSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return apiError(c, 400, "invalid_input", "Invalid payload", parsed.error.flatten());
  const request = await one<{ id: string; status: string }>(
    c.env.DB.prepare(`${SELECT} WHERE id = ?`).bind(c.req.param("id")),
  );
  if (!request) return apiError(c, 404, "not_found", "Early repayment request not found");
  if (request.status !== "pending") {
    return apiError(c, 400, "invalid_status", "Only pending requests can be approved");
  }

  await c.env.DB.prepare(
    "UPDATE early_repayment_requests SET status = 'approved', resolved_at = ?, admin_comment = ? WHERE id = ?",
  ).bind(nowMs(), parsed.data.adminComment ?? null, request.id).run();
  const row = await one(c.env.DB.prepare(`${SELECT} WHERE id = ?`).bind(request.id));
  return c.json(row);
});

earlyRepayments.post("/:id/reject", requireAuth, requireRole("admin"), async (c) => {
  const parsed = DecisionSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return apiError(c, 400, "invalid_input", "Invalid payload", parsed.error.flatten());
  const request = await one<{ id: string; status: string }>(
    c.env.DB.prepare(`${SELECT} WHERE id = ?`).bind(c.req.param("id")),
  );
  if (!request) return apiError(c, 404, "not_found", "Early repayment request not found");
  if (request.status !== "pending") {
    return apiError(c, 400, "invalid_status", "Only pending requests can be rejected");
  }

  await c.env.DB.prepare(
    "UPDATE early_repayment_requests SET status = 'rejected', resolved_at = ?, admin_comment = ? WHERE id = ?",
  ).bind(nowMs(), parsed.data.adminComment ?? null, request.id).run();
  const row = await one(c.env.DB.prepare(`${SELECT} WHERE id = ?`).bind(request.id));
  return c.json(row);
});

earlyRepayments.post("/:id/mark-paid", requireAuth, requireRole("admin"), async (c) => {
  const parsed = MarkPaidSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return apiError(c, 400, "invalid_input", "Invalid payload", parsed.error.flatten());

  const request = await one<{ id: string; loanId: string; memberId: string; status: string; chargeAmount: number; requestedForDate?: number | null } & Record<string, unknown>>(
    c.env.DB.prepare(`${SELECT} WHERE id = ?`).bind(c.req.param("id")),
  );
  if (!request) return apiError(c, 404, "not_found", "Early repayment request not found");
  if (request.status !== "approved") {
    return apiError(c, 400, "invalid_status", "Only approved requests can be marked paid");
  }

  const loan = await one<RepaymentPostingLoan & Record<string, unknown>>(
    c.env.DB.prepare(
      "SELECT id, outstanding, interest_rate_pct, status, repayment_plan, repayment_start_month, repayment_day_of_month, approved_at AS approvedAt, applied_at AS appliedAt FROM loans WHERE id = ?",
    ).bind(request.loanId),
  );
  if (!loan) return apiError(c, 404, "not_found", "Loan not found");

  const existingRepayments = await all<LoanRepaymentRow>(
    c.env.DB.prepare(
      "SELECT id, loan_id AS loanId, month, is_early_payment AS isEarlyPayment, payment_status AS paymentStatus, amount, principal_portion AS principalPortion, interest_portion AS interestPortion, guarantor_portion AS guarantorPortion, paid_at AS paidAt, created_at AS createdAt FROM loan_repayments WHERE loan_id = ? ORDER BY paid_at ASC",
    ).bind(request.loanId),
  );
  const loanCharges = await all<LoanChargeRow>(
    c.env.DB.prepare(
      "SELECT id, loan_id AS loanId, amount, applies_to_month AS appliesToMonth, kind, note, note AS description, created_at AS createdAt FROM loan_charges WHERE loan_id = ? ORDER BY created_at ASC",
    ).bind(request.loanId),
  );

  const parsedLoan = parseLoan(
    {
      ...loan,
      repaymentPlan: loan.repayment_plan,
      repaymentStartMonth: loan.repayment_start_month,
      repaymentDayOfMonth: loan.repayment_day_of_month,
      outstanding: loan.outstanding,
    },
    existingRepayments,
    loanCharges,
  );
  const remainingRows = (parsedLoan.repaymentPlan ?? []).filter((row: any) => row.status === "pending" || row.status === "late");
  if (remainingRows.length === 0) {
    return apiError(c, 400, "no_remaining_schedule", "This loan no longer has pending installments");
  }

  const paidAt = parsed.data.paidAt ?? request.requestedForDate ?? nowMs();
  const userId = c.get("user")!.id;
  const stmts: D1PreparedStatement[] = [];
  const repaymentIds: string[] = [];
  const workingCharges = [...loanCharges];

  const penaltyAmount = Math.max(0, Number(request.chargeAmount ?? 0) - remainingRows.reduce((sum: number, row: any) => sum + (Number(row.chargeAmount) || 0), 0));
  if (penaltyAmount > 0) {
    const penaltyChargeId = newId("chg");
    const penaltyCharge: LoanChargeRow = {
      id: penaltyChargeId,
      loanId: request.loanId,
      amount: penaltyAmount,
      appliesToMonth: remainingRows[0].month,
      kind: "penalty",
      description: "Early repayment penalty",
      note: String(parsed.data.adminComment ?? request.adminComment ?? "Early repayment penalty"),
      createdAt: paidAt,
    };
    workingCharges.push(penaltyCharge);
    stmts.push(
      c.env.DB.prepare(
        "INSERT INTO loan_charges (id, loan_id, kind, amount, note, applies_to_month, created_at) VALUES (?,?,?,?,?,?,?)",
      ).bind(
        penaltyChargeId,
        request.loanId,
        "penalty",
        penaltyAmount,
        penaltyCharge.note ?? "Early repayment penalty",
        remainingRows[0].month,
        paidAt,
      ),
    );
  }

  const reparsedLoan = parseLoan(
    {
      ...loan,
      repaymentPlan: loan.repayment_plan,
      repaymentStartMonth: loan.repayment_start_month,
      repaymentDayOfMonth: loan.repayment_day_of_month,
      outstanding: loan.outstanding,
    },
    existingRepayments,
    workingCharges,
  );
  const rowsToSettle = (reparsedLoan.repaymentPlan ?? []).filter((row: any) => row.status === "pending" || row.status === "late");

  for (const row of rowsToSettle) {
    const repaymentId = newId("rep");
    repaymentIds.push(repaymentId);
    const { chargePortion, interestPortion, principalPortion, guarantorPortion, newOutstanding } = allocateRepayment(
      loan,
      row.total,
      row.interest,
      row.chargeAmount ?? 0,
    );
    const statusResult = getValidatedRepaymentStatus(
      {
        loanId: request.loanId,
        month: row.month,
        amount: row.total,
        paidAt,
        isEarlyPayment: true,
      },
      paidAt,
    );
    if (!statusResult.ok) {
      return apiError(c, 400, statusResult.code, statusResult.message);
    }

    stmts.push(
      ...buildRepaymentStatements(
        c.env.DB,
        userId,
        repaymentId,
        request.loanId,
        row.month,
        row.total,
        paidAt,
        true,
        statusResult.status,
        chargePortion,
        principalPortion,
        interestPortion,
        guarantorPortion,
        newOutstanding,
      ),
    );
    loan.outstanding = newOutstanding;
    existingRepayments.push({
      id: repaymentId,
      loanId: request.loanId,
      month: row.month,
      isEarlyPayment: true,
      paymentStatus: statusResult.status,
      amount: row.total,
      principalPortion,
      interestPortion,
      guarantorPortion,
      paidAt,
      createdAt: nowMs(),
    });
  }

  stmts.push(
    c.env.DB.prepare(
      "UPDATE early_repayment_requests SET status = 'paid', paid_at = ?, resolved_at = ?, admin_comment = ? WHERE id = ?",
    ).bind(paidAt, nowMs(), parsed.data.adminComment ?? request.adminComment ?? null, request.id),
  );

  await c.env.DB.batch(stmts);
  const row = await one(c.env.DB.prepare(`${SELECT} WHERE id = ?`).bind(request.id));
  return c.json({ request: row, repaymentIds });
});
