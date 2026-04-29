import { Hono } from "hono";
import { z } from "zod";
import type { AppContext } from "../middleware";
import { apiError, requireAuth, requireRole } from "../middleware";
import { all, newId, nowMs, one } from "../db";

export const loans = new Hono<AppContext>();

const SELECT = `SELECT id, member_id AS memberId, type, principal, interest_rate_pct AS interestRatePct,
  term_months AS termMonths, purpose, status, outstanding, applied_at AS appliedAt, approved_at AS approvedAt,
  approved_by AS approvedBy, rejected_reason AS rejectedReason, due_at AS dueAt FROM loans`;

loans.get("/", requireAuth, async (c) => c.json(await all(c.env.DB.prepare(`${SELECT} ORDER BY applied_at DESC`))));

loans.get("/:id", requireAuth, async (c) => {
  const row = await one(c.env.DB.prepare(`${SELECT} WHERE id = ?`).bind(c.req.param("id")));
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
});

loans.post("/:id/charges", requireAuth, requireRole("admin"), async (c) => {
  const parsed = ChargeSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return apiError(c, 400, "invalid_input", "Invalid payload", parsed.error.flatten());
  const id = newId("chg");
  const loanId = c.req.param("id");
  await c.env.DB.prepare(
    "INSERT INTO loan_charges (id, loan_id, kind, amount, note, created_at) VALUES (?,?,?,?,?,?)"
  )
    .bind(id, loanId, parsed.data.kind, parsed.data.amount, parsed.data.note ?? null, nowMs())
    .run();
  return c.json(
    await one(
      c.env.DB.prepare(
        "SELECT id, loan_id AS loanId, kind, amount, note, created_at AS createdAt FROM loan_charges WHERE id = ?"
      ).bind(id)
    ),
    201
  );
});

// ---------- Repayments (server-authoritative allocation) ----------
loans.get("/:id/repayments", requireAuth, async (c) => {
  const rows = await all(
    c.env.DB.prepare(
      "SELECT id, loan_id AS loanId, amount, principal_portion AS principalPortion, interest_portion AS interestPortion, guarantor_portion AS guarantorPortion, paid_at AS paidAt, created_at AS createdAt FROM loan_repayments WHERE loan_id = ? ORDER BY paid_at DESC"
    ).bind(c.req.param("id"))
  );
  return c.json(rows);
});

const RepaymentSchema = z.object({
  amount: z.number().int().positive(),
  paidAt: z.number().optional(),
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
  const stmts: D1PreparedStatement[] = [
    c.env.DB.prepare(
      "INSERT INTO loan_repayments (id, loan_id, amount, principal_portion, interest_portion, guarantor_portion, paid_at, recorded_by, created_at) VALUES (?,?,?,?,?,?,?,?,?)"
    ).bind(id, loanId, parsed.data.amount, principalPortion, interestPortion, guarantorPortion, paidAt, userId, nowMs()),
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
        "SELECT id, loan_id AS loanId, amount, principal_portion AS principalPortion, interest_portion AS interestPortion, guarantor_portion AS guarantorPortion, paid_at AS paidAt, created_at AS createdAt FROM loan_repayments WHERE id = ?"
      ).bind(id)
    ),
    201
  );
});
