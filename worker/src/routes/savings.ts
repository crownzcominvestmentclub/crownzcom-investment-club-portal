import { Hono } from "hono";
import { z } from "zod";
import type { AppContext } from "../middleware";
import { apiError, requireAuth, requireRole } from "../middleware";
import { all, newId, nowMs, one } from "../db";

export const savings = new Hono<AppContext>();

const SELECT = `SELECT id, member_id AS memberId, printf('%04d-%02d', period_year, period_month) AS month, amount, status, paid_at AS paidAt, created_at AS createdAt FROM savings`;

savings.get("/", requireAuth, async (c) => {
  return c.json(await all(c.env.DB.prepare(`${SELECT} ORDER BY period_year DESC, period_month DESC`)));
});

savings.get("/total", requireAuth, async (c) => {
  const r = await one<{ total: number }>(c.env.DB.prepare("SELECT COALESCE(SUM(amount),0) AS total FROM savings"));
  return c.json(r?.total ?? 0);
});

const EntrySchema = z.object({
  memberId: z.string(),
  periodMonth: z.number().int().min(1).max(12),
  periodYear: z.number().int().min(2000).max(2100),
  amount: z.number().int().positive(),
  status: z.enum(["paid", "partial", "missed"]).default("paid"),
  paidAt: z.number().optional(),
});

function periodKey(memberId: string, periodYear: number, periodMonth: number) {
  return `${memberId}:${periodYear}-${String(periodMonth).padStart(2, "0")}`;
}

async function findExistingSavingsKeys(db: D1Database, entries: Array<z.infer<typeof EntrySchema>>) {
  if (entries.length === 0) return new Set<string>();
  const conditions = entries.map(() => "(member_id = ? AND period_year = ? AND period_month = ?)").join(" OR ");
  const binds = entries.flatMap((entry) => [entry.memberId, entry.periodYear, entry.periodMonth]);
  const rows = await all<{ memberId: string; periodYear: number; periodMonth: number }>(
    db.prepare(
      `SELECT member_id AS memberId, period_year AS periodYear, period_month AS periodMonth
       FROM savings
       WHERE ${conditions}`
    ).bind(...binds),
  );
  return new Set(rows.map((row) => periodKey(row.memberId, row.periodYear, row.periodMonth)));
}

savings.post("/", requireAuth, requireRole("admin"), async (c) => {
  const parsed = EntrySchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return apiError(c, 400, "invalid_input", "Invalid payload", parsed.error.flatten());
  const e = parsed.data;
  const existingKeys = await findExistingSavingsKeys(c.env.DB, [e]);
  if (existingKeys.has(periodKey(e.memberId, e.periodYear, e.periodMonth))) {
    return apiError(c, 409, "duplicate_period", "A savings entry already exists for this member and month");
  }
  const id = newId("sav");
  const userId = c.get("user")!.id;
  await c.env.DB.batch([
    c.env.DB.prepare(
      "INSERT INTO savings (id, member_id, period_month, period_year, amount, status, paid_at, created_at, created_by) VALUES (?,?,?,?,?,?,?,?,?)"
    ).bind(id, e.memberId, e.periodMonth, e.periodYear, e.amount, e.status, e.paidAt ?? nowMs(), nowMs(), userId),
    ...ledgerForSavings(c.env.DB, id, e.memberId, e.amount, e.paidAt ?? nowMs()),
  ]);
  return c.json(await one(c.env.DB.prepare(`${SELECT} WHERE id = ?`).bind(id)), 201);
});

const BatchSchema = z.object({ entries: z.array(EntrySchema).min(1).max(500) });

// Server-authoritative bulk add — single batch transaction also writes ledger.
savings.post("/batch", requireAuth, requireRole("admin"), async (c) => {
  const parsed = BatchSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return apiError(c, 400, "invalid_input", "Invalid payload", parsed.error.flatten());
  const userId = c.get("user")!.id;
  const requestedKeys = new Set<string>();
  for (const entry of parsed.data.entries) {
    const key = periodKey(entry.memberId, entry.periodYear, entry.periodMonth);
    if (requestedKeys.has(key)) {
      return apiError(c, 409, "duplicate_period_in_batch", "The batch contains duplicate member-month savings entries");
    }
    requestedKeys.add(key);
  }
  const existingKeys = await findExistingSavingsKeys(c.env.DB, parsed.data.entries);
  if (existingKeys.size > 0) {
    return apiError(c, 409, "duplicate_period", "One or more selected member-month savings entries already exist");
  }
  const stmts: D1PreparedStatement[] = [];
  const ids: string[] = [];
  for (const e of parsed.data.entries) {
    const id = newId("sav");
    ids.push(id);
    stmts.push(
      c.env.DB.prepare(
        "INSERT INTO savings (id, member_id, period_month, period_year, amount, status, paid_at, created_at, created_by) VALUES (?,?,?,?,?,?,?,?,?)"
      ).bind(id, e.memberId, e.periodMonth, e.periodYear, e.amount, e.status, e.paidAt ?? nowMs(), nowMs(), userId),
      ...ledgerForSavings(c.env.DB, id, e.memberId, e.amount, e.paidAt ?? nowMs())
    );
  }
  await c.env.DB.batch(stmts);
  const placeholders = ids.map(() => "?").join(",");
  const rows = await all(c.env.DB.prepare(`${SELECT} WHERE id IN (${placeholders})`).bind(...ids));
  return c.json(rows, 201);
});

function ledgerForSavings(db: D1Database, refId: string, memberId: string, amount: number, occurredAt: number) {
  const debit = newId("led");
  const credit = newId("led");
  return [
    db
      .prepare(
        "INSERT INTO ledger (id, occurred_at, account, direction, amount, ref_type, ref_id, memo, created_at) VALUES (?,?,?,?,?,?,?,?,?)"
      )
      .bind(debit, occurredAt, "cash", "debit", amount, "savings", refId, `Savings deposit ${memberId}`, nowMs()),
    db
      .prepare(
        "INSERT INTO ledger (id, occurred_at, account, direction, amount, ref_type, ref_id, memo, created_at) VALUES (?,?,?,?,?,?,?,?,?)"
      )
      .bind(credit, occurredAt, "savings_liability", "credit", amount, "savings", refId, `Member ${memberId}`, nowMs()),
  ];
}
