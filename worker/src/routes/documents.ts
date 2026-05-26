// Documents are R2-backed: the Worker mints short-lived signed PUT URLs using
// a temporary HMAC token, then the client PUTs the bytes directly. After upload
// the client calls POST /api/documents to register the row in D1.

import { Hono, type Context } from "hono";
import { z } from "zod";
import type { AppContext } from "../middleware";
import { apiError, requireAuth, requireRole } from "../middleware";
import { all, newId, nowMs, one } from "../db";

export const documents = new Hono<AppContext>();
export const documentCategories = new Hono<AppContext>();
export const uploads = new Hono<AppContext>();

documentCategories.get("/", requireAuth, async (c) =>
  c.json(await all(c.env.DB.prepare("SELECT id, name FROM document_categories ORDER BY name")))
);

const SELECT = `SELECT
  d.id,
  d.category_id AS categoryId,
  d.title,
  d.object_key AS objectKey,
  d.content_type AS contentType,
  d.size_bytes AS sizeBytes,
  d.scope,
  d.uploaded_at AS uploadedAt,
  d.uploaded_by AS uploadedBy,
  d.tags,
  d.period,
  d.notes,
  c.name AS categoryName
FROM documents d
LEFT JOIN document_categories c ON d.category_id = c.id`;

function normalizeDocument(row: any) {
  if (!row) return null;

  return {
    id: row.id,
    title: row.title,
    categoryId: row.categoryId ?? undefined,
    category: row.categoryName || "Uncategorized",
    scope: row.scope || "general",
    fileId: row.objectKey,
    objectKey: row.objectKey,
    bucketId: "documents",
    contentType: row.contentType ?? undefined,
    sizeBytes: row.sizeBytes ?? undefined,
    uploadedBy: row.uploadedBy,
    uploadedAt: new Date(row.uploadedAt).toISOString(),
    tags: row.tags ? JSON.parse(row.tags) : undefined,
    period: row.period || undefined,
    notes: row.notes || undefined,
  };
}

async function buildSignedDownloadUrl(c: Context<AppContext>, objectKey: string) {
  const exp = Math.floor(Date.now() / 1000) + 300;
  const token = await sign(c.env.JWT_SECRET, `dl|${objectKey}|${exp}`);
  const origin = new URL(c.req.url).origin;
  return `${origin}/api/uploads/get/${encodeURIComponent(objectKey)}?token=${token}&exp=${exp}`;
}

documents.get("/", requireAuth, async (c) =>
  c.json((await all(c.env.DB.prepare(`${SELECT} ORDER BY d.uploaded_at DESC`))).map(normalizeDocument))
);

documents.get("/loan-terms", requireAuth, async (c) => {
  const row = await one(
    c.env.DB.prepare(
      `${SELECT}
       WHERE d.scope = 'loan_terms'
          OR lower(d.title) = 'loan terms and conditions'
          OR lower(ifnull(d.tags, '')) LIKE '%loan%'
       ORDER BY d.uploaded_at DESC
       LIMIT 1`
    )
  );

  return c.json(row ? normalizeDocument(row) : null);
});

const RegisterSchema = z.object({
  categoryId: z.string().nullable().optional(),
  title: z.string().min(1),
  objectKey: z.string().min(1),
  contentType: z.string().optional(),
  sizeBytes: z.number().int().positive().optional(),
  tags: z.array(z.string()).optional(),
  period: z.string().optional(),
  notes: z.string().optional(),
  scope: z.enum(["general", "loan_terms"]).default("general"),
});

documents.post("/", requireAuth, requireRole("admin"), async (c) => {
  const p = RegisterSchema.safeParse(await c.req.json().catch(() => null));
  if (!p.success) return apiError(c, 400, "invalid_input", "Invalid payload", p.error.flatten());

  const id = newId("doc");
  await c.env.DB.prepare(
    `INSERT INTO documents (
      id, category_id, title, object_key, content_type, size_bytes, scope, tags, period, notes, uploaded_at, uploaded_by
    ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`
  )
    .bind(
      id,
      p.data.categoryId ?? null,
      p.data.title,
      p.data.objectKey,
      p.data.contentType ?? null,
      p.data.sizeBytes ?? null,
      p.data.scope,
      p.data.tags ? JSON.stringify(p.data.tags) : null,
      p.data.period ?? null,
      p.data.notes ?? null,
      nowMs(),
      c.get("user")!.id
    )
    .run();

  return c.json(normalizeDocument(await one(c.env.DB.prepare(`${SELECT} WHERE d.id = ?`).bind(id))), 201);
});

documents.get("/:id", requireAuth, async (c) =>
  c.json(normalizeDocument(await one(c.env.DB.prepare(`${SELECT} WHERE d.id = ?`).bind(c.req.param("id")))))
);

const UpdateSchema = z.object({
  title: z.string().min(1).optional(),
  categoryId: z.string().nullable().optional(),
  tags: z.array(z.string()).optional(),
  period: z.string().optional(),
  notes: z.string().optional(),
  scope: z.enum(["general", "loan_terms"]).optional(),
});

documents.patch("/:id", requireAuth, requireRole("admin"), async (c) => {
  const id = c.req.param("id");
  const p = UpdateSchema.safeParse(await c.req.json().catch(() => null));
  if (!p.success) return apiError(c, 400, "invalid_input", "Invalid payload", p.error.flatten());

  const updates: string[] = [];
  const values: unknown[] = [];
  if (p.data.title !== undefined) { updates.push("title = ?"); values.push(p.data.title); }
  if (p.data.categoryId !== undefined) { updates.push("category_id = ?"); values.push(p.data.categoryId); }
  if (p.data.tags !== undefined) { updates.push("tags = ?"); values.push(JSON.stringify(p.data.tags)); }
  if (p.data.period !== undefined) { updates.push("period = ?"); values.push(p.data.period); }
  if (p.data.notes !== undefined) { updates.push("notes = ?"); values.push(p.data.notes); }
  if (p.data.scope !== undefined) { updates.push("scope = ?"); values.push(p.data.scope); }

  if (updates.length === 0) return apiError(c, 400, "no_updates", "No valid updates provided");

  await c.env.DB.prepare(`UPDATE documents SET ${updates.join(", ")} WHERE id = ?`)
    .bind(...values, id)
    .run();

  return c.json(normalizeDocument(await one(c.env.DB.prepare(`${SELECT} WHERE d.id = ?`).bind(id))));
});

documents.delete("/:id", requireAuth, requireRole("admin"), async (c) => {
  const id = c.req.param("id");
  const row = await one<{ objectKey: string }>(
    c.env.DB.prepare("SELECT object_key AS objectKey FROM documents WHERE id = ?").bind(id)
  );
  if (!row) return apiError(c, 404, "not_found", "Document not found");

  await c.env.BUCKET.delete(row.objectKey);
  await c.env.DB.prepare("DELETE FROM documents WHERE id = ?").bind(id).run();
  return c.body(null, 204);
});

documents.get("/:id/download", requireAuth, async (c) => {
  const id = c.req.param("id");
  const row = await one<{ objectKey: string }>(
    c.env.DB.prepare("SELECT object_key AS objectKey FROM documents WHERE id = ?").bind(id)
  );
  if (!row) return apiError(c, 404, "not_found", "Document not found");

  return c.json({ url: await buildSignedDownloadUrl(c, row.objectKey) });
});

// ---------- Signed upload URLs ----------
//
// We issue a short-lived (5 min) HMAC token bound to (objectKey, contentType, exp).
// The client PUTs to: `${origin}/api/uploads/put/{objectKey}?token=...&ct=...&exp=...`
// The Worker validates the token, then streams the body into R2.

const SignSchema = z.object({
  filename: z.string().min(1),
  contentType: z.string().min(1),
  scope: z.enum(["documents", "avatars"]).default("documents"),
});

uploads.post("/sign", requireAuth, requireRole("admin"), async (c) => {
  const p = SignSchema.safeParse(await c.req.json().catch(() => null));
  if (!p.success) return apiError(c, 400, "invalid_input", "Invalid payload", p.error.flatten());

  const safeName = p.data.filename.replace(/[^a-zA-Z0-9._-]/g, "_");
  const objectKey = `${p.data.scope}/${Date.now()}_${crypto.randomUUID()}_${safeName}`;
  const exp = Math.floor(Date.now() / 1000) + 300;
  const token = await sign(c.env.JWT_SECRET, `${objectKey}|${p.data.contentType}|${exp}`);
  const origin = new URL(c.req.url).origin;
  const uploadUrl = `${origin}/api/uploads/put/${encodeURIComponent(objectKey)}?token=${token}&ct=${encodeURIComponent(
    p.data.contentType
  )}&exp=${exp}`;

  return c.json({ uploadUrl, objectKey, expiresIn: 300 });
});

uploads.put("/put/:key{.+}", async (c) => {
  const key = decodeURIComponent(c.req.param("key"));
  const ct = c.req.query("ct") ?? "";
  const exp = parseInt(c.req.query("exp") ?? "0", 10);
  const token = c.req.query("token") ?? "";
  if (!exp || exp * 1000 < Date.now()) return apiError(c, 401, "expired", "Upload URL expired");

  const expected = await sign(c.env.JWT_SECRET, `${key}|${ct}|${exp}`);
  if (expected !== token) return apiError(c, 401, "bad_token", "Invalid upload token");

  await c.env.BUCKET.put(key, c.req.raw.body, { httpMetadata: { contentType: ct } });
  return c.json({ objectKey: key });
});

uploads.post("/sign-download", requireAuth, async (c) => {
  const p = z.object({ objectKey: z.string().min(1) }).safeParse(await c.req.json().catch(() => null));
  if (!p.success) return apiError(c, 400, "invalid_input", "objectKey required");

  return c.json({
    url: await buildSignedDownloadUrl(c, p.data.objectKey),
    expiresIn: 300,
  });
});

uploads.get("/get/:key{.+}", async (c) => {
  const key = decodeURIComponent(c.req.param("key"));
  const exp = parseInt(c.req.query("exp") ?? "0", 10);
  const token = c.req.query("token") ?? "";
  if (!exp || exp * 1000 < Date.now()) return apiError(c, 401, "expired", "Link expired");

  const expected = await sign(c.env.JWT_SECRET, `dl|${key}|${exp}`);
  if (expected !== token) return apiError(c, 401, "bad_token", "Invalid token");

  const obj = await c.env.BUCKET.get(key);
  if (!obj) return apiError(c, 404, "not_found", "Object not found");

  const headers = new Headers();
  obj.writeHttpMetadata(headers);
  headers.set("etag", obj.httpEtag);
  return new Response(obj.body, { headers });
});

async function sign(secret: string, data: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(data));
  const bytes = new Uint8Array(sig);
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
