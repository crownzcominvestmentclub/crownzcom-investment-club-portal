import { Hono } from "hono";
import { z } from "zod";
import type { AppContext } from "../middleware";
import { apiError, requireAuth, requireRole } from "../middleware";
import { all, newId, nowMs, one } from "../db";

export const members = new Hono<AppContext>();

interface MemberRow {
  id: string;
  fullName: string;
  email: string;
  phone: string | null;
  status: "active" | "suspended" | "exited";
  joinedAt: number;
  notes: string | null;
}

const SELECT = `SELECT id, full_name AS fullName, email, phone, status, joined_at AS joinedAt, notes FROM members`;

members.get("/", requireAuth, async (c) => {
  const rows = await all<MemberRow>(c.env.DB.prepare(`${SELECT} ORDER BY full_name`));
  return c.json(rows);
});

members.get("/:id", requireAuth, async (c) => {
  const row = await one<MemberRow>(c.env.DB.prepare(`${SELECT} WHERE id = ?`).bind(c.req.param("id")));
  if (!row) return apiError(c, 404, "not_found", "Member not found");
  return c.json(row);
});

const CreateSchema = z.object({
  fullName: z.string().min(1),
  email: z.string().email(),
  phone: z.string().optional(),
  status: z.enum(["active", "suspended", "exited"]).default("active"),
  notes: z.string().optional(),
});

members.post("/", requireAuth, requireRole("admin"), async (c) => {
  const parsed = CreateSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return apiError(c, 400, "invalid_input", "Invalid payload", parsed.error.flatten());
  const id = newId("mem");
  const { fullName, email, phone, status, notes } = parsed.data;
  await c.env.DB.prepare(
    "INSERT INTO members (id, full_name, email, phone, status, joined_at, notes) VALUES (?,?,?,?,?,?,?)"
  )
    .bind(id, fullName, email.toLowerCase(), phone ?? null, status, nowMs(), notes ?? null)
    .run();
  const row = await one<MemberRow>(c.env.DB.prepare(`${SELECT} WHERE id = ?`).bind(id));
  return c.json(row, 201);
});

const PatchSchema = CreateSchema.partial();

members.patch("/:id", requireAuth, requireRole("admin"), async (c) => {
  const parsed = PatchSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return apiError(c, 400, "invalid_input", "Invalid payload", parsed.error.flatten());
  const id = c.req.param("id");
  const sets: string[] = [];
  const binds: unknown[] = [];
  const map: Record<string, string> = {
    fullName: "full_name",
    email: "email",
    phone: "phone",
    status: "status",
    notes: "notes",
  };
  for (const [k, v] of Object.entries(parsed.data)) {
    if (v === undefined) continue;
    sets.push(`${map[k]} = ?`);
    binds.push(v);
  }
  if (sets.length === 0) return apiError(c, 400, "no_changes", "No fields to update");
  binds.push(id);
  await c.env.DB.prepare(`UPDATE members SET ${sets.join(", ")} WHERE id = ?`)
    .bind(...binds)
    .run();
  const row = await one<MemberRow>(c.env.DB.prepare(`${SELECT} WHERE id = ?`).bind(id));
  return c.json(row);
});

members.delete("/:id", requireAuth, requireRole("admin"), async (c) => {
  await c.env.DB.prepare("DELETE FROM members WHERE id = ?").bind(c.req.param("id")).run();
  return c.body(null, 204);
});

// Member-scoped sub-resources
members.get("/:id/savings", requireAuth, async (c) => {
  const rows = await all(
    c.env.DB.prepare(
      "SELECT id, member_id AS memberId, period_month AS periodMonth, period_year AS periodYear, amount, status, paid_at AS paidAt, created_at AS createdAt FROM savings WHERE member_id = ? ORDER BY period_year DESC, period_month DESC"
    ).bind(c.req.param("id"))
  );
  return c.json(rows);
});

members.get("/:id/savings/total", requireAuth, async (c) => {
  const r = await one<{ total: number }>(
    c.env.DB.prepare("SELECT COALESCE(SUM(amount),0) AS total FROM savings WHERE member_id = ?").bind(c.req.param("id"))
  );
  return c.json(r?.total ?? 0);
});

members.get("/:id/loans", requireAuth, async (c) => {
  const rows = await all(
    c.env.DB.prepare(
      "SELECT id, member_id AS memberId, type, principal, interest_rate_pct AS interestRatePct, term_months AS termMonths, purpose, status, outstanding, applied_at AS appliedAt, approved_at AS approvedAt FROM loans WHERE member_id = ? ORDER BY applied_at DESC"
    ).bind(c.req.param("id"))
  );
  return c.json(rows);
});

members.get("/:id/subscriptions", requireAuth, async (c) => {
  const rows = await all(
    c.env.DB.prepare(
      "SELECT id, member_id AS memberId, period_year AS periodYear, amount, status, paid_at AS paidAt FROM subscriptions WHERE member_id = ? ORDER BY period_year DESC"
    ).bind(c.req.param("id"))
  );
  return c.json(rows);
});

members.get("/:id/guarantor-requests", requireAuth, async (c) => {
  const status = c.req.query("status");
  const sql =
    "SELECT id, loan_id AS loanId, guarantor_id AS guarantorId, amount, status, comment, responded_at AS respondedAt, created_at AS createdAt FROM loan_guarantors WHERE guarantor_id = ?" +
    (status ? " AND status = ?" : "") +
    " ORDER BY created_at DESC";
  const stmt = status
    ? c.env.DB.prepare(sql).bind(c.req.param("id"), status)
    : c.env.DB.prepare(sql).bind(c.req.param("id"));
  return c.json(await all(stmt));
});

members.get("/:id/early-repayments", requireAuth, async (c) => {
  const rows = await all(
    c.env.DB.prepare(
      "SELECT id, loan_id AS loanId, member_id AS memberId, amount, status, requested_at AS requestedAt, resolved_at AS resolvedAt FROM early_repayment_requests WHERE member_id = ? ORDER BY requested_at DESC"
    ).bind(c.req.param("id"))
  );
  return c.json(rows);
});
