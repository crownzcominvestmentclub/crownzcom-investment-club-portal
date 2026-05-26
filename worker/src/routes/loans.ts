import { Hono } from "hono";
import type { Context } from "hono";
import { z } from "zod";
import type { AppContext } from "../middleware";
import { apiError, requireAuth, requireRole } from "../middleware";
import { all, newId, nowMs, one } from "../db";

export const loans = new Hono<AppContext>();

type RepaymentPlanRow = {
  month: string;
  principal: number;
  interest: number;
  total: number;
  remainingBalance: number;
  status: string;
  paidAt: number | null;
  chargeAmount: number;
};

export type LoanRepaymentRow = {
  id: string;
  loanId: string;
  month?: string | null;
  amount: number;
  principalPortion: number;
  interestPortion: number;
  guarantorPortion: number;
  paidAt: number;
  createdAt: number;
  isEarlyPayment?: boolean;
  paymentStatus?: string;
};

export type LoanChargeRow = {
  id: string;
  loanId: string;
  kind: string;
  amount: number;
  note?: string | null;
  description?: string | null;
  createdAt: number;
  appliesToMonth?: string | null;
};

export type RepaymentPostingLoan = {
  id: string;
  memberId: string;
  memberName?: string;
  memberNumber?: string;
  outstanding: number;
  principal: number;
  interest_rate_pct: number;
  status: string;
  type?: string;
  repaymentPlan: RepaymentPlanRow[];
  interestCalculationModeApplied: "flat" | "reducing";
  monthlyInterestRateApplied: number;
};

function toMoney(value: unknown): number {
  const num = typeof value === "number" ? value : Number(value ?? 0);
  return Number.isFinite(num) ? num : 0;
}

function asPlanMonth(value: unknown, index: number) {
  if (typeof value === "string" && value.trim().length > 0) return value;
  if (typeof value === "number" && Number.isFinite(value)) return `installment-${value}`;
  return `installment-${index + 1}`;
}

function parseRepaymentPlan(raw: unknown): RepaymentPlanRow[] {
  if (typeof raw !== "string" || raw.trim().length === 0) return [];
  try {
    const parsed = JSON.parse(raw) as Array<Record<string, unknown>>;
    if (!Array.isArray(parsed)) return [];
    return parsed.map((row, index) => {
      const principal = toMoney(row.principal);
      const interest = toMoney(row.interest);
      const chargeAmount = toMoney(row.chargeAmount ?? row.charge_amount);
      const total = toMoney(row.total ?? row.payment) || principal + interest + chargeAmount;
      return {
        month: asPlanMonth(row.month, index),
        principal,
        interest,
        total,
        remainingBalance: toMoney(row.remainingBalance ?? row.remaining_balance),
        status: typeof row.status === "string" ? row.status : "pending",
        paidAt:
          typeof row.paidAt === "number"
            ? row.paidAt
            : typeof row.paid_at === "number"
              ? row.paid_at
              : null,
        chargeAmount,
      };
    });
  } catch {
    return [];
  }
}

export async function getRepaymentsByLoanIds(db: D1Database, loanIds: string[]) {
  const map = new Map<string, LoanRepaymentRow[]>();
  if (loanIds.length === 0) return map;
  const placeholders = loanIds.map(() => "?").join(", ");
  const rows = await all<any>(
    db.prepare(
      `SELECT id,
              loan_id AS loanId,
              month,
              amount,
              principal_portion AS principalPortion,
              interest_portion AS interestPortion,
              guarantor_portion AS guarantorPortion,
              paid_at AS paidAt,
              created_at AS createdAt,
              is_early_payment AS isEarlyPayment,
              payment_status AS paymentStatus
       FROM loan_repayments
       WHERE loan_id IN (${placeholders})
       ORDER BY paid_at ASC, created_at ASC`,
    ).bind(...loanIds),
  );
  for (const row of rows) {
    const item: LoanRepaymentRow = {
      id: row.id,
      loanId: row.loanId,
      month: row.month ?? null,
      amount: toMoney(row.amount),
      principalPortion: toMoney(row.principalPortion),
      interestPortion: toMoney(row.interestPortion),
      guarantorPortion: toMoney(row.guarantorPortion),
      paidAt: toMoney(row.paidAt),
      createdAt: toMoney(row.createdAt),
      isEarlyPayment: Boolean(row.isEarlyPayment),
      paymentStatus: typeof row.paymentStatus === "string" ? row.paymentStatus : "paid",
    };
    const bucket = map.get(item.loanId) ?? [];
    bucket.push(item);
    map.set(item.loanId, bucket);
  }
  return map;
}

export async function getChargesByLoanIds(db: D1Database, loanIds: string[]) {
  const map = new Map<string, LoanChargeRow[]>();
  if (loanIds.length === 0) return map;
  const placeholders = loanIds.map(() => "?").join(", ");
  const rows = await all<any>(
    db.prepare(
      `SELECT id,
              loan_id AS loanId,
              kind,
              amount,
              note,
              note AS description,
              created_at AS createdAt,
              applies_to_month AS appliesToMonth
       FROM loan_charges
       WHERE loan_id IN (${placeholders})
       ORDER BY created_at ASC`,
    ).bind(...loanIds),
  );
  for (const row of rows) {
    const item: LoanChargeRow = {
      id: row.id,
      loanId: row.loanId,
      kind: row.kind,
      amount: toMoney(row.amount),
      note: row.note ?? null,
      description: row.description ?? null,
      createdAt: toMoney(row.createdAt),
      appliesToMonth: row.appliesToMonth ?? null,
    };
    const bucket = map.get(item.loanId) ?? [];
    bucket.push(item);
    map.set(item.loanId, bucket);
  }
  return map;
}

export function parseLoan(
  loan: Record<string, unknown>,
  repayments: LoanRepaymentRow[],
  charges: LoanChargeRow[],
): RepaymentPostingLoan {
  const repaymentPlan = parseRepaymentPlan(loan.repaymentPlan ?? loan.repayment_plan);
  const chargesByMonth = new Map<string, number>();
  for (const charge of charges) {
    const month = charge.appliesToMonth ?? repaymentPlan[0]?.month;
    if (!month) continue;
    chargesByMonth.set(month, (chargesByMonth.get(month) ?? 0) + toMoney(charge.amount));
  }
  const repaymentsByMonth = new Map<string, LoanRepaymentRow[]>();
  for (const repayment of repayments) {
    if (!repayment.month) continue;
    const bucket = repaymentsByMonth.get(repayment.month) ?? [];
    bucket.push(repayment);
    repaymentsByMonth.set(repayment.month, bucket);
  }
  const plan = repaymentPlan.map((row) => {
    const chargeAmount = chargesByMonth.get(row.month) ?? row.chargeAmount ?? 0;
    const paymentRows = repaymentsByMonth.get(row.month) ?? [];
    const last = paymentRows[paymentRows.length - 1];
    return {
      ...row,
      total: row.principal + row.interest + chargeAmount,
      chargeAmount,
      status: last?.paymentStatus ?? row.status ?? "pending",
      paidAt: last?.paidAt ?? row.paidAt ?? null,
    };
  });
  return {
    id: String(loan.id),
    memberId: String(loan.memberId ?? loan.member_id ?? ""),
    memberName: typeof loan.memberName === "string" ? loan.memberName : typeof loan.member_name === "string" ? loan.member_name : undefined,
    memberNumber: typeof loan.memberNumber === "string" ? loan.memberNumber : typeof loan.member_number === "string" ? loan.member_number : undefined,
    outstanding: toMoney(loan.outstanding),
    principal: toMoney(loan.principal),
    interest_rate_pct: toMoney(loan.interest_rate_pct ?? loan.interestRatePct),
    status: String(loan.status ?? "pending"),
    type: typeof loan.type === "string" ? loan.type : undefined,
    repaymentPlan: plan,
    interestCalculationModeApplied:
      String(
        loan.interestCalculationModeApplied ??
          loan.interest_calculation_mode_applied ??
          loan.repaymentType ??
          loan.repayment_type ??
          "flat",
      ) === "reducing"
        ? "reducing"
        : "flat",
    monthlyInterestRateApplied: toMoney(
      loan.monthlyInterestRateApplied ??
        loan.monthly_interest_rate_applied ??
        loan.interestRatePct ??
        loan.interest_rate_pct,
    ),
  };
}

export function allocateRepayment(
  loan: RepaymentPostingLoan,
  amount: number,
  scheduledInterest = 0,
  scheduledCharge = 0,
) {
  const chargePortion = Math.min(amount, Math.max(0, scheduledCharge));
  const afterCharge = Math.max(0, amount - chargePortion);
  const interestDue =
    scheduledInterest > 0
      ? scheduledInterest
      : loan.interestCalculationModeApplied === "flat"
        ? Math.floor((loan.principal * loan.monthlyInterestRateApplied) / 100)
        : Math.floor((loan.outstanding * loan.monthlyInterestRateApplied) / 100);
  const interestPortion = Math.min(afterCharge, Math.max(0, interestDue));
  const principalPortion = Math.min(Math.max(0, afterCharge - interestPortion), loan.outstanding);
  const guarantorPortion = 0;
  const newOutstanding = Math.max(0, loan.outstanding - principalPortion);
  return { chargePortion, interestPortion, principalPortion, guarantorPortion, newOutstanding };
}

export function getValidatedRepaymentStatus(
  input: {
    paymentStatus?: string;
    isEarlyPayment?: boolean;
    loanId?: string;
    month?: string | null;
    amount?: number;
    paidAt?: number;
  },
  _paidAt: number,
): { ok: true; status: string } | { ok: false; code: string; message: string } {
  const normalized = input.paymentStatus?.trim().toLowerCase();
  const status =
    normalized === "paid" || normalized === "late" || normalized === "pending" || normalized === "early"
      ? normalized
      : input.isEarlyPayment
        ? "early"
        : "paid";
  return { ok: true as const, status };
}

export function buildRepaymentStatements(
  db: D1Database,
  userId: string,
  repaymentId: string,
  loanId: string,
  month: string | null,
  amount: number,
  paidAt: number,
  isEarlyPayment: boolean,
  paymentStatus: string,
  chargePortion: number,
  principalPortion: number,
  interestPortion: number,
  guarantorPortion: number,
  newOutstanding: number,
) {
  const createdAt = nowMs();
  const statements: D1PreparedStatement[] = [
    db
      .prepare(
        `INSERT INTO loan_repayments (
          id, loan_id, month, is_early_payment, payment_status,
          amount, principal_portion, interest_portion, guarantor_portion,
          paid_at, recorded_by, created_at
        ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
      )
      .bind(
        repaymentId,
        loanId,
        month,
        isEarlyPayment ? 1 : 0,
        paymentStatus,
        amount,
        principalPortion,
        interestPortion,
        guarantorPortion,
        paidAt,
        userId,
        createdAt,
      ),
    db
      .prepare(
        "UPDATE loans SET outstanding = ?, status = CASE WHEN ? = 0 THEN 'completed' ELSE status END WHERE id = ?",
      )
      .bind(newOutstanding, newOutstanding, loanId),
    db
      .prepare(
        "INSERT INTO ledger (id, occurred_at, account, direction, amount, ref_type, ref_id, memo, created_at) VALUES (?,?,?,?,?,?,?,?,?)",
      )
      .bind(newId("led"), paidAt, "cash", "debit", amount, "repayment", repaymentId, `Loan repayment ${loanId}`, createdAt),
  ];

  if (principalPortion > 0) {
    statements.push(
      db
        .prepare(
          "INSERT INTO ledger (id, occurred_at, account, direction, amount, ref_type, ref_id, memo, created_at) VALUES (?,?,?,?,?,?,?,?,?)",
        )
        .bind(newId("led"), paidAt, "loans_receivable", "credit", principalPortion, "repayment", repaymentId, "Principal", createdAt),
    );
  }
  if (interestPortion > 0) {
    statements.push(
      db
        .prepare(
          "INSERT INTO ledger (id, occurred_at, account, direction, amount, ref_type, ref_id, memo, created_at) VALUES (?,?,?,?,?,?,?,?,?)",
        )
        .bind(newId("led"), paidAt, "interest_income", "credit", interestPortion, "repayment", repaymentId, "Interest", createdAt),
    );
  }
  if (chargePortion > 0) {
    statements.push(
      db
        .prepare(
          "INSERT INTO ledger (id, occurred_at, account, direction, amount, ref_type, ref_id, memo, created_at) VALUES (?,?,?,?,?,?,?,?,?)",
        )
        .bind(newId("led"), paidAt, "loan_charge_income", "credit", chargePortion, "repayment", repaymentId, "Charges", createdAt),
    );
  }
  return statements;
}

const SELECT = `SELECT loans.id, loans.member_id AS memberId, members.full_name AS memberName,
  members.membership_number AS memberNumber, loans.type, loans.principal, loans.interest_rate_pct AS interestRatePct,
  loans.term_months AS termMonths, loans.purpose, loans.status, loans.outstanding, loans.applied_at AS appliedAt, loans.approved_at AS approvedAt,
  approved_by AS approvedBy, rejected_reason AS rejectedReason, due_at AS dueAt, repayment_type AS repaymentType,
  repayment_plan AS repaymentPlan, terms_accepted AS termsAccepted, borrower_coverage AS borrowerCoverage,
  repayment_start_month AS repaymentStartMonth, first_repayment_date AS firstRepaymentDate,
  repayment_day_of_month AS repaymentDayOfMonth, repayment_plan_version AS repaymentPlanVersion,
  repayment_plan_generated_at AS repaymentPlanGeneratedAt, repayment_plan_basis AS repaymentPlanBasis,
  interest_calculation_mode_applied AS interestCalculationModeApplied
  FROM loans
  LEFT JOIN members ON members.id = loans.member_id`;

async function listLoansWithDetails(c: Context<AppContext>, stmt: D1PreparedStatement) {
  const rows = await all<Record<string, unknown>>(stmt);
  const loanIds = rows.map((row) => String(row.id));
  const repaymentsByLoanId = await getRepaymentsByLoanIds(c.env.DB, loanIds);
  const chargesByLoanId = await getChargesByLoanIds(c.env.DB, loanIds);
  return rows.map((row) => parseLoan(row, repaymentsByLoanId.get(String(row.id)) ?? [], chargesByLoanId.get(String(row.id)) ?? []));
}

loans.get("/repayments", requireAuth, async (c) => {
  const rows = await all(
    c.env.DB.prepare(
      `SELECT id, loan_id AS loanId, month, is_early_payment AS isEarlyPayment, payment_status AS paymentStatus,
              amount, principal_portion AS principalPortion, interest_portion AS interestPortion,
              guarantor_portion AS guarantorPortion, paid_at AS paidAt, created_at AS createdAt
       FROM loan_repayments
       ORDER BY paid_at DESC, created_at DESC`,
    ),
  );
  return c.json(rows);
});

loans.get("/charges", requireAuth, async (c) => {
  const rows = await all(
    c.env.DB.prepare(
      `SELECT id, loan_id AS loanId, kind, amount, note, note AS description,
              applies_to_month AS appliesToMonth, created_at AS createdAt
       FROM loan_charges
       ORDER BY created_at DESC`,
    ),
  );
  return c.json(rows);
});

loans.delete("/charges/:chargeId", requireAuth, requireRole("admin"), async (c) => {
  const chargeId = c.req.param("chargeId");
  const existing = await one(c.env.DB.prepare("SELECT id FROM loan_charges WHERE id = ?").bind(chargeId));
  if (!existing) return apiError(c, 404, "not_found", "Charge not found");
  await c.env.DB.prepare("DELETE FROM loan_charges WHERE id = ?").bind(chargeId).run();
  return c.body(null, 204);
});

loans.get("/", requireAuth, async (c) =>
  c.json(await listLoansWithDetails(c, c.env.DB.prepare(`${SELECT} ORDER BY applied_at DESC`))));

loans.get("/:id", requireAuth, async (c) => {
  const rows = await listLoansWithDetails(c, c.env.DB.prepare(`${SELECT} WHERE id = ?`).bind(c.req.param("id")));
  const row = rows[0];
  if (!row) return apiError(c, 404, "not_found", "Loan not found");
  return c.json(row);
});

// ---------- Validation (server-authoritative eligibility check) ----------
const ValidateSchema = z.object({
  memberId: z.string(),
  principal: z.number().int().positive(),
  type: z.enum(["short_term", "long_term", "emergency"]),
});

loans.post("/validate", requireAuth, async (c) => {
  const parsed = ValidateSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return apiError(c, 400, "invalid_input", "Invalid payload", parsed.error.flatten());
  const { memberId, principal } = parsed.data;
  const cfg = await one<{ loan_eligibility_pct: number }>(
    c.env.DB.prepare("SELECT loan_eligibility_pct FROM financial_config WHERE id = 1")
  );
  const savings = await one<{ total: number }>(
    c.env.DB.prepare("SELECT COALESCE(SUM(amount),0) AS total FROM savings WHERE member_id = ?").bind(memberId)
  );
  const cap = Math.floor(((savings?.total ?? 0) * (cfg?.loan_eligibility_pct ?? 300)) / 100);
  const reasons: string[] = [];
  if (principal > cap) reasons.push(`Requested amount exceeds eligibility cap (UGX ${cap.toLocaleString()}).`);
  return c.json({ ok: reasons.length === 0, cap, reasons });
});

// ---------- Submit long-term loan ----------
const SubmitSchema = z.object({
  memberId: z.string(),
  type: z.enum(["short_term", "long_term", "emergency"]),
  principal: z.number().int().positive(),
  termMonths: z.number().int().positive(),
  purpose: z.string().optional(),
  guarantors: z
    .array(z.object({ guarantorId: z.string(), amount: z.number().int().positive() }))
    .optional(),
});

loans.post("/", requireAuth, async (c) => {
  const parsed = SubmitSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return apiError(c, 400, "invalid_input", "Invalid payload", parsed.error.flatten());
  const s = parsed.data;
  const cfg = await one<{ short_term_rate_pct: number; long_term_rate_pct: number }>(
    c.env.DB.prepare("SELECT short_term_rate_pct, long_term_rate_pct FROM financial_config WHERE id = 1")
  );
  const rate = s.type === "long_term" ? cfg?.long_term_rate_pct ?? 3 : cfg?.short_term_rate_pct ?? 5;
  const id = newId("loan");
  const status = s.guarantors && s.guarantors.length > 0 ? "guarantors_pending" : "pending";

  const stmts: D1PreparedStatement[] = [
    c.env.DB.prepare(
      "INSERT INTO loans (id, member_id, type, principal, interest_rate_pct, term_months, purpose, status, outstanding, applied_at) VALUES (?,?,?,?,?,?,?,?,?,?)"
    ).bind(id, s.memberId, s.type, s.principal, rate, s.termMonths, s.purpose ?? null, status, s.principal, nowMs()),
  ];
  for (const g of s.guarantors ?? []) {
    stmts.push(
      c.env.DB.prepare(
        "INSERT INTO loan_guarantors (id, loan_id, guarantor_id, amount, status, created_at) VALUES (?,?,?,?, 'pending', ?)"
      ).bind(newId("grnt"), id, g.guarantorId, g.amount, nowMs())
    );
  }
  await c.env.DB.batch(stmts);
  return c.json(await one(c.env.DB.prepare(`${SELECT} WHERE id = ?`).bind(id)), 201);
});

// ---------- Final approve / reject ----------
loans.post("/:id/final-approve", requireAuth, requireRole("admin"), async (c) => {
  const id = c.req.param("id");
  const userId = c.get("user")!.id;
  await c.env.DB.prepare(
    "UPDATE loans SET status = 'active', approved_at = ?, approved_by = ? WHERE id = ? AND status IN ('pending','guarantors_pending','approved')"
  )
    .bind(nowMs(), userId, id)
    .run();
  return c.json(await one(c.env.DB.prepare(`${SELECT} WHERE id = ?`).bind(id)));
});

loans.post("/:id/reject", requireAuth, requireRole("admin"), async (c) => {
  const body = z.object({ reason: z.string().min(1) }).safeParse(await c.req.json().catch(() => null));
  if (!body.success) return apiError(c, 400, "invalid_input", "Reason required");
  const id = c.req.param("id");
  await c.env.DB.prepare("UPDATE loans SET status = 'rejected', rejected_reason = ? WHERE id = ?")
    .bind(body.data.reason, id)
    .run();
  return c.json(await one(c.env.DB.prepare(`${SELECT} WHERE id = ?`).bind(id)));
});

// ---------- Guarantors ----------
loans.get("/:id/guarantors", requireAuth, async (c) => {
  const rows = await all(
    c.env.DB.prepare(
      "SELECT id, loan_id AS loanId, guarantor_id AS guarantorId, amount, status, comment, responded_at AS respondedAt, created_at AS createdAt FROM loan_guarantors WHERE loan_id = ?"
    ).bind(c.req.param("id"))
  );
  return c.json(rows);
});

// ---------- Charges ----------
loans.get("/:id/charges", requireAuth, async (c) => {
  const rows = await all(
    c.env.DB.prepare(
      "SELECT id, loan_id AS loanId, kind, amount, note, created_at AS createdAt FROM loan_charges WHERE loan_id = ?"
    ).bind(c.req.param("id"))
  );
  return c.json(rows);
});

const ChargeSchema = z.object({
  kind: z.enum(["processing_fee", "penalty", "insurance", "other"]),
  amount: z.number().int().positive(),
  note: z.string().optional(),
  appliesToMonth: z.string().regex(/^\d{4}-\d{2}$/).optional(),
});

loans.post("/:id/charges", requireAuth, requireRole("admin"), async (c) => {
  const parsed = ChargeSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return apiError(c, 400, "invalid_input", "Invalid payload", parsed.error.flatten());
  const id = newId("chg");
  const loanId = c.req.param("id");
  await c.env.DB.prepare(
    "INSERT INTO loan_charges (id, loan_id, kind, amount, note, applies_to_month, created_at) VALUES (?,?,?,?,?,?,?)"
  )
    .bind(id, loanId, parsed.data.kind, parsed.data.amount, parsed.data.note ?? null, parsed.data.appliesToMonth ?? null, nowMs())
    .run();
  return c.json(
    await one(
      c.env.DB.prepare(
        "SELECT id, loan_id AS loanId, kind, amount, note, note AS description, applies_to_month AS appliesToMonth, created_at AS createdAt FROM loan_charges WHERE id = ?"
      ).bind(id)
    ),
    201
  );
});

// ---------- Repayments (server-authoritative allocation) ----------
loans.get("/:id/repayments", requireAuth, async (c) => {
  const rows = await all(
    c.env.DB.prepare(
      `SELECT id, loan_id AS loanId, month, is_early_payment AS isEarlyPayment, payment_status AS paymentStatus,
              amount, principal_portion AS principalPortion, interest_portion AS interestPortion,
              guarantor_portion AS guarantorPortion, paid_at AS paidAt, created_at AS createdAt
       FROM loan_repayments
       WHERE loan_id = ?
       ORDER BY paid_at DESC, created_at DESC`
    ).bind(c.req.param("id"))
  );
  return c.json(rows);
});

const RepaymentSchema = z.object({
  month: z.string().regex(/^\d{4}-\d{2}$/).optional(),
  amount: z.number().int().positive(),
  paidAt: z.number().optional(),
  isEarlyPayment: z.boolean().optional(),
  paymentStatus: z.enum(["pending", "paid", "late", "early"]).optional(),
});

loans.post("/:id/repayments", requireAuth, requireRole("admin"), async (c) => {
  const parsed = RepaymentSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return apiError(c, 400, "invalid_input", "Invalid payload", parsed.error.flatten());
  const loanId = c.req.param("id");
  const userId = c.get("user")!.id;

  const loan = await one<{ outstanding: number; interest_rate_pct: number; status: string }>(
    c.env.DB.prepare("SELECT outstanding, interest_rate_pct, status FROM loans WHERE id = ?").bind(loanId)
  );
  if (!loan) return apiError(c, 404, "not_found", "Loan not found");

  // Simple allocation: interest first (1 month at current rate), remainder to principal.
  const interestDue = Math.floor((loan.outstanding * loan.interest_rate_pct) / 100);
  const interestPortion = Math.min(parsed.data.amount, interestDue);
  const principalPortion = parsed.data.amount - interestPortion;
  const newOutstanding = Math.max(0, loan.outstanding - principalPortion);

  // Guarantor settlement: if a previous shortfall was covered by guarantors, allocate
  // a slice of the principal back to them. (Stub: 0 for now — extend with real logic.)
  const guarantorPortion = 0;

  const id = newId("rep");
  const paidAt = parsed.data.paidAt ?? nowMs();
  const status = parsed.data.paymentStatus ?? (parsed.data.isEarlyPayment ? "early" : "paid");
  const stmts: D1PreparedStatement[] = [
    c.env.DB.prepare(
      `INSERT INTO loan_repayments (
        id, loan_id, month, is_early_payment, payment_status, amount,
        principal_portion, interest_portion, guarantor_portion, paid_at, recorded_by, created_at
      ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`
    ).bind(
      id,
      loanId,
      parsed.data.month ?? null,
      parsed.data.isEarlyPayment ? 1 : 0,
      status,
      parsed.data.amount,
      principalPortion,
      interestPortion,
      guarantorPortion,
      paidAt,
      userId,
      nowMs(),
    ),
    c.env.DB.prepare(
      "UPDATE loans SET outstanding = ?, status = CASE WHEN ? = 0 THEN 'completed' ELSE status END WHERE id = ?"
    ).bind(newOutstanding, newOutstanding, loanId),
    // Ledger entries
    c.env.DB.prepare(
      "INSERT INTO ledger (id, occurred_at, account, direction, amount, ref_type, ref_id, memo, created_at) VALUES (?,?,?,?,?,?,?,?,?)"
    ).bind(newId("led"), paidAt, "cash", "debit", parsed.data.amount, "repayment", id, `Loan repayment ${loanId}`, nowMs()),
    c.env.DB.prepare(
      "INSERT INTO ledger (id, occurred_at, account, direction, amount, ref_type, ref_id, memo, created_at) VALUES (?,?,?,?,?,?,?,?,?)"
    ).bind(newId("led"), paidAt, "loans_receivable", "credit", principalPortion, "repayment", id, "Principal", nowMs()),
  ];
  if (interestPortion > 0) {
    stmts.push(
      c.env.DB.prepare(
        "INSERT INTO ledger (id, occurred_at, account, direction, amount, ref_type, ref_id, memo, created_at) VALUES (?,?,?,?,?,?,?,?,?)"
      ).bind(newId("led"), paidAt, "interest_income", "credit", interestPortion, "repayment", id, "Interest", nowMs())
    );
  }
  await c.env.DB.batch(stmts);
  return c.json(
    await one(
      c.env.DB.prepare(
        `SELECT id, loan_id AS loanId, month, is_early_payment AS isEarlyPayment, payment_status AS paymentStatus,
                amount, principal_portion AS principalPortion, interest_portion AS interestPortion,
                guarantor_portion AS guarantorPortion, paid_at AS paidAt, created_at AS createdAt
         FROM loan_repayments
         WHERE id = ?`
      ).bind(id)
    ),
    201
  );
});
