import { Hono } from "hono";
import { z } from "zod";
import type { AppContext } from "../middleware";
import { apiError, requireAuth } from "../middleware";
import { all, nowMs, one } from "../db";

export const guarantors = new Hono<AppContext>();

async function getMemberAvailableCredit(db: D1Database, memberId: string) {
  const cfg = await one<{ loan_eligibility_pct: number }>(
    db.prepare("SELECT loan_eligibility_pct FROM financial_config WHERE id = 1"),
  );
  const [savings, outstanding] = await Promise.all([
    one<{ total: number }>(db.prepare("SELECT COALESCE(SUM(amount),0) AS total FROM savings WHERE member_id = ?").bind(memberId)),
    one<{ total: number }>(db.prepare("SELECT COALESCE(SUM(outstanding),0) AS total FROM loans WHERE member_id = ? AND status = 'active'").bind(memberId)),
  ]);
  const totalSavings = savings?.total ?? 0;
  const cap = Math.floor((totalSavings * (cfg?.loan_eligibility_pct ?? 300)) / 100);
  return Math.max(0, cap - (outstanding?.total ?? 0));
}

guarantors.get("/", requireAuth, async (c) => {
  const rows = await all(
    c.env.DB.prepare(
      "SELECT id, loan_id AS loanId, guarantor_id AS guarantorId, amount, status, comment, responded_at AS respondedAt, created_at AS createdAt FROM loan_guarantors ORDER BY created_at DESC"
    )
  );
  return c.json(rows);
});

const RespondSchema = z.object({
  decision: z.enum(["approve", "decline"]),
  comment: z.string().optional(),
});

// Server-authoritative: only the guarantor themselves may respond.
guarantors.post("/:id/respond", requireAuth, async (c) => {
  const parsed = RespondSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return apiError(c, 400, "invalid_input", "Invalid payload", parsed.error.flatten());
  const id = c.req.param("id");
  const me = c.get("user")!;

  const row = await one<{ guarantor_id: string; loan_id: string; status: string; amount: number }>(
    c.env.DB.prepare("SELECT guarantor_id, loan_id, status, amount FROM loan_guarantors WHERE id = ?").bind(id)
  );
  if (!row) return apiError(c, 404, "not_found", "Request not found");
  if (row.status !== "pending") return apiError(c, 409, "already_resolved", "This request has already been answered");
  if (row.guarantor_id !== me.memberId) return apiError(c, 403, "forbidden", "You are not the guarantor on this request");

  const newStatus = parsed.data.decision === "approve" ? "approved" : "declined";
  if (newStatus === "approved") {
    const availableCredit = await getMemberAvailableCredit(c.env.DB, row.guarantor_id);
    if (row.amount > availableCredit) {
      return apiError(
        c,
        409,
        "guarantor_credit_exceeded",
        `You no longer have enough available credit to guarantee UGX ${row.amount.toLocaleString()}.`,
      );
    }
  }
  await c.env.DB.prepare(
    "UPDATE loan_guarantors SET status = ?, comment = ?, responded_at = ? WHERE id = ?"
  )
    .bind(newStatus, parsed.data.comment ?? null, nowMs(), id)
    .run();

  // If any guarantor declines, mark the loan failed. If all approve, move to 'pending' admin review.
  if (newStatus === "declined") {
    await c.env.DB.prepare("UPDATE loans SET status = 'failed', guarantor_approval_status = 'failed' WHERE id = ?").bind(row.loan_id).run();
  } else {
    const [remaining, approvedTotal] = await Promise.all([
      one<{ n: number }>(
      c.env.DB.prepare("SELECT COUNT(*) AS n FROM loan_guarantors WHERE loan_id = ? AND status = 'pending'").bind(
        row.loan_id
      )
      ),
      one<{ total: number }>(
        c.env.DB.prepare("SELECT COALESCE(SUM(amount),0) AS total FROM loan_guarantors WHERE loan_id = ? AND status = 'approved'").bind(row.loan_id),
      ),
    ]);
    await c.env.DB.prepare(
      "UPDATE loans SET guarantor_approved_amount = ?, guarantor_approval_status = ? WHERE id = ?",
    ).bind(
      approvedTotal?.total ?? 0,
      (remaining?.n ?? 0) === 0 ? "complete" : "partial",
      row.loan_id,
    ).run();
    if ((remaining?.n ?? 0) === 0) {
      await c.env.DB.prepare("UPDATE loans SET status = 'approved' WHERE id = ? AND status = 'guarantors_pending'")
        .bind(row.loan_id)
        .run();
    }
  }

  return c.json(
    await one(
      c.env.DB.prepare(
        "SELECT id, loan_id AS loanId, guarantor_id AS guarantorId, amount, status, comment, responded_at AS respondedAt, created_at AS createdAt FROM loan_guarantors WHERE id = ?"
      ).bind(id)
    )
  );
});
