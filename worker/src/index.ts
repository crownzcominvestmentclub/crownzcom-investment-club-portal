// Crownzcom Investment Club — Cloudflare Worker entry point.
//
// Routes mirror the frontend service layer in src/services/index.ts.
// All server-authoritative actions (loan approvals, guarantor responses,
// repayment allocation, ledger writes) live in /routes/loans.ts,
// /routes/guarantors.ts, and /routes/savings.ts.

import { Hono } from "hono";
import type { AppContext } from "./middleware";
import { corsMiddleware, loadSession } from "./middleware";
import { auth } from "./routes/auth";
import { members } from "./routes/members";
import { savings } from "./routes/savings";
import { loans } from "./routes/loans";
import { earlyRepayments } from "./routes/earlyRepayments";
import { guarantors } from "./routes/guarantors";
import {
  expenses,
  financialConfig,
  reports,
  subscriptions,
  unitTrust,
} from "./routes/misc";
import { documents, documentCategories, uploads } from "./routes/documents";
import { config } from "./routes/config";

const app = new Hono<AppContext>();

app.use("*", corsMiddleware());
app.use("*", loadSession);

app.get("/", (c) => c.json({ name: "crownzcom-api", ok: true }));
app.get("/health", (c) => c.json({ ok: true, t: Date.now() }));

const api = new Hono<AppContext>();
api.route("/auth", auth);
api.route("/config", config);
api.route("/members", members);
api.route("/savings", savings);
api.route("/loans", loans);
api.route("/early-repayments", earlyRepayments);
api.route("/guarantor-requests", guarantors);
api.route("/subscriptions", subscriptions);
api.route("/expenses", expenses);
api.route("/unit-trust", unitTrust);
api.route("/reports", reports);
api.route("/financial-config", financialConfig);
api.route("/documents", documents);
api.route("/document-categories", documentCategories);
api.route("/uploads", uploads);

app.route("/api", api);

app.notFound((c) => c.json({ code: "not_found", message: "Route not found" }, 404));
app.onError((err, c) => {
  console.error("worker error", err);
  return c.json({ code: "internal_error", message: err.message ?? "Unexpected error" }, 500);
});

export default app;
