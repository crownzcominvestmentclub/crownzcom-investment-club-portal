import { Hono } from "hono";
import { z } from "zod";
import type { AppContext } from "../middleware";
import { apiError, requireAuth } from "../middleware";
import {
  clearSessionCookie,
  hashPassword,
  loadUserRoles,
  sessionCookie,
  signJwt,
  verifyPassword,
} from "../auth";
import { newId, nowMs } from "../db";

export const auth = new Hono<AppContext>();

const SignInSchema = z.object({ email: z.string().email(), password: z.string().min(1) });

auth.post("/sign-in", async (c) => {
  const parsed = SignInSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return apiError(c, 400, "invalid_input", "Email and password required", parsed.error.flatten());
  const { email, password } = parsed.data;

  const row = await c.env.DB.prepare(
    "SELECT id, email, password_hash, password_salt, display_name, member_id FROM auth_users WHERE email = ? LIMIT 1"
  )
    .bind(email.toLowerCase())
    .first<{
      id: string;
      email: string;
      password_hash: string;
      password_salt: string;
      display_name: string;
      member_id: string | null;
    }>();
  if (!row) return apiError(c, 401, "invalid_credentials", "Email or password is incorrect");

  // Dev convenience: bootstrap the seeded admin on first login.
  if (row.password_hash === "SEED_REHASH_ON_LOGIN") {
    if (password !== "admin1234") return apiError(c, 401, "invalid_credentials", "Email or password is incorrect");
    const { hash, salt } = await hashPassword(password);
    await c.env.DB.prepare("UPDATE auth_users SET password_hash = ?, password_salt = ? WHERE id = ?")
      .bind(hash, salt, row.id)
      .run();
    row.password_hash = hash;
    row.password_salt = salt;
  } else {
    const ok = await verifyPassword(password, row.password_hash, row.password_salt);
    if (!ok) return apiError(c, 401, "invalid_credentials", "Email or password is incorrect");
  }

  const roles = await loadUserRoles(c.env, row.id);
  await c.env.DB.prepare("UPDATE auth_users SET last_login_at = ? WHERE id = ?").bind(nowMs(), row.id).run();

  const user = {
    id: row.id,
    email: row.email,
    displayName: row.display_name,
    memberId: row.member_id,
    roles,
  };
  const token = await signJwt(user, c.env);
  const isProd = (c.req.header("Origin") ?? "").startsWith("https://");
  c.header("Set-Cookie", sessionCookie(c.env, token, isProd));
  return c.json({ user, token });
});

auth.post("/sign-out", async (c) => {
  const isProd = (c.req.header("Origin") ?? "").startsWith("https://");
  c.header("Set-Cookie", clearSessionCookie(c.env, isProd));
  return c.body(null, 204);
});

auth.get("/me", requireAuth, (c) => c.json({ user: c.get("user") }));

// Optional admin tool: list users (admin only).
auth.get("/users", requireAuth, async (c) => {
  const u = c.get("user")!;
  if (!u.roles.includes("admin")) return apiError(c, 403, "forbidden", "Admins only");
  const rows = await c.env.DB.prepare(
    "SELECT id, email, display_name AS displayName, member_id AS memberId FROM auth_users ORDER BY display_name"
  ).all();
  return c.json(rows.results ?? []);
});

const SignUpSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8),
  displayName: z.string().min(1),
  memberId: z.string().optional(),
});

// Admin-only: create a new user account.
auth.post("/users", requireAuth, async (c) => {
  const u = c.get("user")!;
  if (!u.roles.includes("admin")) return apiError(c, 403, "forbidden", "Admins only");
  const parsed = SignUpSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return apiError(c, 400, "invalid_input", "Invalid payload", parsed.error.flatten());
  const { email, password, displayName, memberId } = parsed.data;

  const exists = await c.env.DB.prepare("SELECT 1 FROM auth_users WHERE email = ?").bind(email.toLowerCase()).first();
  if (exists) return apiError(c, 409, "email_taken", "An account with that email already exists");

  const { hash, salt } = await hashPassword(password);
  const id = newId("usr");
  await c.env.DB.prepare(
    "INSERT INTO auth_users (id, email, password_hash, password_salt, display_name, member_id, created_at) VALUES (?,?,?,?,?,?,?)"
  )
    .bind(id, email.toLowerCase(), hash, salt, displayName, memberId ?? null, nowMs())
    .run();
  await c.env.DB.prepare("INSERT INTO user_roles (user_id, role) VALUES (?, 'member')").bind(id).run();
  return c.json({ id, email, displayName, memberId: memberId ?? null }, 201);
});
