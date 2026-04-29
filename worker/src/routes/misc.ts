// Smaller resource routes grouped here for brevity.

import { Hono } from "hono";
import { z } from "zod";
import type { AppContext } from "../middleware";
import { apiError, requireAuth, requireRole } from "../middleware";
import { all, newId, nowMs, one } from "../db";

// ---------- Subscriptions ----------
export const subscriptions = new Hono<AppContext>();
subscriptions.get("/", requireAuth, async (c) =>
  c.json(
    await all(
      c.env.DB.prepare(
        "SELECT id, member_id AS memberId, period_year AS periodYear, amount, status, paid_at AS paidAt FROM subscriptions ORDER BY period_year DESC"
      )
    )
  )
);
const SubSchema = z.object({
  memberId: z.string(),
  periodYear: z.number().int(),
  amount: z.number().int().positive(),
  status: z.enum(["paid", "due", "overdue"]),
  paidAt: z.number().optional(),
});
subscriptions.post("/", requireAuth, requireRole("admin"), async (c) => {
  const p = SubSchema.safeParse(await c.req.json().catch(() => null));
  if (!p.success) return apiError(c, 400, "invalid_input", "Invalid payload", p.error.flatten());
  const id = newId("sub");
  await c.env.DB.prepare(
    "INSERT INTO subscriptions (id, member_id, period_year, amount, status, paid_at, created_at) VALUES (?,?,?,?,?,?,?)"
  )
    .bind(id, p.data.memberId, p.data.periodYear, p.data.amount, p.data.status, p.data.paidAt ?? null, nowMs())
    .run();
  return c.json({ id, ...p.data }, 201);
});

// ---------- Expenses ----------
export const expenses = new Hono<AppContext>();
expenses.get("/", requireAuth, async (c) =>
  c.json(
    await all(
      c.env.DB.prepare(
        "SELECT id, category, amount, note, incurred_at AS incurredAt, created_at AS createdAt FROM expenses ORDER BY incurred_at DESC"
      )
    )
  )
);
const ExpenseSchema = z.object({
  category: z.string().min(1),
  amount: z.number().int().positive(),
  note: z.string().optional(),
  incurredAt: z.number().optional(),
});
expenses.post("/", requireAuth, requireRole("admin"), async (c) => {
  const p = ExpenseSchema.safeParse(await c.req.json().catch(() => null));
  if (!p.success) return apiError(c, 400, "invalid_input", "Invalid payload", p.error.flatten());
  const id = newId("exp");
  await c.env.DB.prepare(
    "INSERT INTO expenses (id, category, amount, note, incurred_at, created_at, created_by) VALUES (?,?,?,?,?,?,?)"
  )
    .bind(id, p.data.category, p.data.amount, p.data.note ?? null, p.data.incurredAt ?? nowMs(), nowMs(), c.get("user")!.id)
    .run();
  return c.json({ id, ...p.data }, 201);
});

// ---------- Unit trust ----------
export const unitTrust = new Hono<AppContext>();
unitTrust.get("/", requireAuth, async (c) =>
  c.json(
    await all(
      c.env.DB.prepare(
        "SELECT id, kind, amount, occurred_at AS occurredAt, note, created_at AS createdAt FROM unit_trust ORDER BY occurred_at DESC"
      )
    )
  )
);
const UTSchema = z.object({
  kind: z.enum(["deposit", "withdrawal", "interest"]),
  amount: z.number().int().positive(),
  occurredAt: z.number().optional(),
  note: z.string().optional(),
});
unitTrust.post("/", requireAuth, requireRole("admin"), async (c) => {
  const p = UTSchema.safeParse(await c.req.json().catch(() => null));
  if (!p.success) return apiError(c, 400, "invalid_input", "Invalid payload", p.error.flatten());
  const id = newId("ut");
  await c.env.DB.prepare(
    "INSERT INTO unit_trust (id, kind, amount, occurred_at, note, created_at) VALUES (?,?,?,?,?,?)"
  )
    .bind(id, p.data.kind, p.data.amount, p.data.occurredAt ?? nowMs(), p.data.note ?? null, nowMs())
    .run();
  return c.json({ id, ...p.data }, 201);
});

// ---------- Reports ----------
export const reports = new Hono<AppContext>();
reports.get("/ledger", requireAuth, async (c) =>
  c.json(
    await all(
      c.env.DB.prepare(
        "SELECT id, occurred_at AS occurredAt, account, direction, amount, ref_type AS refType, ref_id AS refId, memo, created_at AS createdAt FROM ledger ORDER BY occurred_at DESC LIMIT 1000"
      )
    )
  )
);
reports.get("/interest-monthly", requireAuth, async (c) =>
  c.json(
    await all(
      c.env.DB.prepare(
        "SELECT id, period_month AS periodMonth, period_year AS periodYear, amount FROM interest_monthly ORDER BY period_year DESC, period_month DESC"
      )
    )
  )
);
reports.get("/retained-earnings", requireAuth, async (c) =>
  c.json(
    await all(
      c.env.DB.prepare("SELECT id, period_year AS periodYear, amount FROM retained_earnings ORDER BY period_year DESC")
    )
  )
);

// ---------- Financial config ----------
export const financialConfig = new Hono<AppContext>();
financialConfig.get("/", requireAuth, async (c) => {
  const r = await one(
    c.env.DB.prepare(
      "SELECT currency, monthly_contribution AS monthlyContribution, short_term_rate_pct AS shortTermRatePct, long_term_rate_pct AS longTermRatePct, loan_eligibility_pct AS loanEligibilityPct, late_penalty_pct AS latePenaltyPct, updated_at AS updatedAt FROM financial_config WHERE id = 1"
    )
  );
  return c.json(r ?? {});
});
const ConfigPatch = z
  .object({
    monthlyContribution: z.number().int().positive(),
    shortTermRatePct: z.number().nonnegative(),
    longTermRatePct: z.number().nonnegative(),
    loanEligibilityPct: z.number().nonnegative(),
    latePenaltyPct: z.number().nonnegative(),
  })
  .partial();
financialConfig.patch("/", requireAuth, requireRole("admin"), async (c) => {
  const p = ConfigPatch.safeParse(await c.req.json().catch(() => null));
  if (!p.success) return apiError(c, 400, "invalid_input", "Invalid payload", p.error.flatten());
  const map: Record<string, string> = {
    monthlyContribution: "monthly_contribution",
    shortTermRatePct: "short_term_rate_pct",
    longTermRatePct: "long_term_rate_pct",
    loanEligibilityPct: "loan_eligibility_pct",
    latePenaltyPct: "late_penalty_pct",
  };
  const sets: string[] = [];
  const binds: unknown[] = [];
  for (const [k, v] of Object.entries(p.data)) {
    if (v === undefined) continue;
    sets.push(`${map[k]} = ?`);
    binds.push(v);
  }
  if (sets.length === 0) return apiError(c, 400, "no_changes", "No fields to update");
  sets.push("updated_at = ?");
  binds.push(nowMs());
  await c.env.DB.prepare(`UPDATE financial_config SET ${sets.join(", ")} WHERE id = 1`)
    .bind(...binds)
    .run();
  return c.redirect("/api/financial-config", 303);
});
