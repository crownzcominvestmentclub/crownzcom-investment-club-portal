// Documents are R2-backed: the Worker mints short-lived signed PUT URLs using
// a temporary HMAC token, then the client PUTs the bytes directly. After upload
// the client calls POST /api/documents to register the row in D1.

import { Hono } from "hono";
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

const SELECT = `SELECT id, category_id AS categoryId, title, object_key AS objectKey, content_type AS contentType,
  size_bytes AS sizeBytes, uploaded_at AS uploadedAt, uploaded_by AS uploadedBy FROM documents`;

documents.get("/", requireAuth, async (c) =>
  c.json(await all(c.env.DB.prepare(`${SELECT} ORDER BY uploaded_at DESC`)))
);

const RegisterSchema = z.object({
  categoryId: z.string().nullable().optional(),
  title: z.string().min(1),
  objectKey: z.string().min(1),
  contentType: z.string().optional(),
  sizeBytes: z.number().int().positive().optional(),
});

documents.post("/", requireAuth, requireRole("admin"), async (c) => {
  const p = RegisterSchema.safeParse(await c.req.json().catch(() => null));
  if (!p.success) return apiError(c, 400, "invalid_input", "Invalid payload", p.error.flatten());
  const id = newId("doc");
  await c.env.DB.prepare(
    "INSERT INTO documents (id, category_id, title, object_key, content_type, size_bytes, uploaded_at, uploaded_by) VALUES (?,?,?,?,?,?,?,?)"
  )
    .bind(
      id,
      p.data.categoryId ?? null,
      p.data.title,
      p.data.objectKey,
      p.data.contentType ?? null,
      p.data.sizeBytes ?? null,
      nowMs(),
      c.get("user")!.id
    )
    .run();
  return c.json(await one(c.env.DB.prepare(`${SELECT} WHERE id = ?`).bind(id)), 201);
});

documents.delete("/:id", requireAuth, requireRole("admin"), async (c) => {
  const id = c.req.param("id");
  const row = await one<{ object_key: string }>(
    c.env.DB.prepare("SELECT object_key FROM documents WHERE id = ?").bind(id)
  );
  if (row) await c.env.BUCKET.delete(row.object_key).catch(() => {});
  await c.env.DB.prepare("DELETE FROM documents WHERE id = ?").bind(id).run();
  return c.body(null, 204);
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

// Short-lived signed download URL (proxy through the Worker for ACL).
uploads.post("/sign-download", requireAuth, async (c) => {
  const p = z.object({ objectKey: z.string().min(1) }).safeParse(await c.req.json().catch(() => null));
  if (!p.success) return apiError(c, 400, "invalid_input", "objectKey required");
  const exp = Math.floor(Date.now() / 1000) + 300;
  const token = await sign(c.env.JWT_SECRET, `dl|${p.data.objectKey}|${exp}`);
  const origin = new URL(c.req.url).origin;
  return c.json({
    url: `${origin}/api/uploads/get/${encodeURIComponent(p.data.objectKey)}?token=${token}&exp=${exp}`,
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
