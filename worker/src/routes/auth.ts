import { Hono } from "hono";
import type { Context } from "hono";
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

const parseAdminEmails = (env: AppContext["Bindings"]): string[] =>
  (env.ADMIN_EMAILS ?? "")
    .split(",")
    .map((email) => email.trim().toLowerCase())
    .filter(Boolean);

const isAdminEmail = (env: AppContext["Bindings"], email: string) =>
  parseAdminEmails(env).includes(email.toLowerCase());

function appLoginUrl(env: AppContext["Bindings"]) {
  const httpsOrigin = (env.ALLOWED_ORIGINS ?? "")
    .split(",")
    .map((origin) => origin.trim())
    .find((origin) => origin.startsWith("https://"));
  return `${httpsOrigin ?? "https://crownzcom-club.pages.dev"}/login`;
}

function renderAuthNoticePage(
  c: Context<AppContext>,
  {
    status,
    title,
    message,
    hint,
  }: {
    status: number;
    title: string;
    message: string;
    hint?: string;
  },
) {
  const loginUrl = appLoginUrl(c.env);
  const html = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${title} | Crownzcom Investment Club</title>
    <style>
      :root {
        color-scheme: light;
        --bg: #f4f7f5;
        --card: #ffffff;
        --text: #183153;
        --muted: #62748e;
        --accent: #1f7a53;
        --border: #d9e4dd;
      }
      * { box-sizing: border-box; }
      body {
        margin: 0;
        min-height: 100vh;
        display: grid;
        place-items: center;
        padding: 24px;
        background:
          radial-gradient(circle at top left, rgba(31,122,83,0.10), transparent 34%),
          linear-gradient(180deg, #f8fbf9 0%, var(--bg) 100%);
        font-family: "Segoe UI", Arial, sans-serif;
        color: var(--text);
      }
      .card {
        width: min(100%, 540px);
        background: var(--card);
        border: 1px solid var(--border);
        border-radius: 20px;
        padding: 32px;
        box-shadow: 0 18px 40px rgba(20, 48, 35, 0.08);
      }
      .eyebrow {
        margin: 0 0 10px;
        font-size: 12px;
        font-weight: 700;
        letter-spacing: 0.18em;
        text-transform: uppercase;
        color: var(--accent);
      }
      h1 {
        margin: 0 0 12px;
        font-size: 30px;
        line-height: 1.15;
      }
      p {
        margin: 0;
        font-size: 16px;
        line-height: 1.6;
        color: var(--muted);
      }
      .hint {
        margin-top: 14px;
      }
      .actions {
        margin-top: 28px;
      }
      a.button {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        min-width: 180px;
        padding: 12px 18px;
        border-radius: 12px;
        background: var(--accent);
        color: #fff;
        text-decoration: none;
        font-weight: 600;
      }
    </style>
  </head>
  <body>
    <main class="card">
      <p class="eyebrow">Crownzcom Investment Club</p>
      <h1>${title}</h1>
      <p>${message}</p>
      ${hint ? `<p class="hint">${hint}</p>` : ""}
      <div class="actions">
        <a class="button" href="${loginUrl}">Back to sign in</a>
      </div>
    </main>
  </body>
</html>`;
  c.status(status as 200 | 201 | 202 | 203 | 204 | 205 | 206 | 300 | 301 | 302 | 303 | 304 | 305 | 307 | 308 | 400 | 401 | 402 | 403 | 404 | 405 | 406 | 407 | 408 | 409 | 410 | 411 | 412 | 413 | 414 | 415 | 416 | 417 | 418 | 421 | 422 | 423 | 424 | 425 | 426 | 428 | 429 | 431 | 451 | 500 | 501 | 502 | 503 | 504 | 505 | 506 | 507 | 508 | 510 | 511);
  return c.html(html);
}

async function findMemberByEmail(c: Context<AppContext>, email: string) {
  return c.env.DB.prepare("SELECT id, full_name FROM members WHERE lower(email) = ? LIMIT 1")
    .bind(email.toLowerCase())
    .first<{ id: string; full_name: string }>();
}

async function ensureLinkedMemberId(c: Context<AppContext>, userId: string, email: string, currentMemberId: string | null) {
  if (currentMemberId) return currentMemberId;
  const member = await findMemberByEmail(c, email);
  if (!member?.id) return null;
  await c.env.DB.prepare("UPDATE auth_users SET member_id = ? WHERE id = ?").bind(member.id, userId).run();
  return member.id;
}

async function getEffectiveRoles(c: Context<AppContext>, userId: string, email: string) {
  const roles = await loadUserRoles(c.env, userId);
  return roles.filter((role) => role !== "admin" || isAdminEmail(c.env, email));
}

auth.post("/sign-in", async (c) => {
  const parsed = SignInSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return apiError(c, 400, "invalid_input", "Email and password required", parsed.error.flatten());
  const { email, password } = parsed.data;

  if (c.env.EMAIL_PASSWORD_SIGNIN_ENABLED?.toLowerCase() === "false") {
    return apiError(c, 403, "email_password_disabled", "Email/password sign in is disabled");
  }

  const member = await findMemberByEmail(c, email);
  if (!member?.id) {
    return apiError(c, 403, "member_not_allowed", "You are not allowed to sign in to this club");
  }

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

  const memberId = await ensureLinkedMemberId(c, row.id, row.email, row.member_id);
  const roles = await getEffectiveRoles(c, row.id, row.email);
  await c.env.DB.prepare("UPDATE auth_users SET last_login_at = ? WHERE id = ?").bind(nowMs(), row.id).run();

  const user = {
    id: row.id,
    email: row.email,
    displayName: member.full_name || row.display_name,
    memberId,
    roles,
  };
  const token = await signJwt(user, c.env);
  const isProd = (c.req.header("Origin") ?? "").startsWith("https://");
  c.header("Set-Cookie", sessionCookie(c.env, token, isProd));
  return c.json(user);
});

auth.post("/sign-out", async (c) => {
  const isProd = (c.req.header("Origin") ?? "").startsWith("https://");
  c.header("Set-Cookie", clearSessionCookie(c.env, isProd));
  return c.body(null, 204);
});

auth.get("/me", requireAuth, async (c) => {
  const currentUser = c.get("user");
  if (!currentUser) return apiError(c, 401, "unauthorized", "Authentication required");

  const row = await c.env.DB.prepare(
    "SELECT id, email, display_name, member_id FROM auth_users WHERE id = ? LIMIT 1"
  )
    .bind(currentUser.id)
    .first<{ id: string; email: string; display_name: string; member_id: string | null }>();

  if (!row) return apiError(c, 404, "not_found", "User account not found");

  const member = await findMemberByEmail(c, row.email);
  if (!member?.id) return apiError(c, 403, "member_not_allowed", "You are not allowed to sign in to this club");

  const memberId = await ensureLinkedMemberId(c, row.id, row.email, row.member_id);
  const roles = await getEffectiveRoles(c, row.id, row.email);

  return c.json({
    id: row.id,
    email: row.email,
    displayName: member.full_name || row.display_name,
    memberId,
    roles,
  });
});

auth.get("/lookup", async (c) => {
  const email = c.req.query("email");
  if (!email || typeof email !== "string") return apiError(c, 400, "invalid_input", "Missing email");

  const row = await c.env.DB.prepare(
    "SELECT id, email, display_name, member_id FROM auth_users WHERE email = ? LIMIT 1"
  )
    .bind(email.toLowerCase())
    .first<{ id: string; email: string; display_name: string; member_id: string | null }>();

  if (!row) return c.json(null);

  const member = await findMemberByEmail(c, row.email);
  if (!member?.id) return c.json(null);

  const memberId = await ensureLinkedMemberId(c, row.id, row.email, row.member_id);
  const roles = await getEffectiveRoles(c, row.id, row.email);
  return c.json({
    id: row.id,
    email: row.email,
    displayName: member.full_name || row.display_name,
    memberId,
    roles,
  });
});

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

// Google OAuth routes
auth.get("/google/sign-in", async (c) => {
  const clientId = c.env.GOOGLE_CLIENT_ID;
  const baseUrl = c.env.WORKER_URL ?? "http://localhost:8787";
  const redirectUri = `${baseUrl}/api/auth/google/callback`;
  const scope = "openid email profile";
  const state = crypto.randomUUID();
  const authUrl = `https://accounts.google.com/o/oauth2/v2/auth?client_id=${clientId}&redirect_uri=${encodeURIComponent(redirectUri)}&response_type=code&scope=${encodeURIComponent(scope)}&state=${state}`;
  return c.redirect(authUrl);
});

auth.get("/google/callback", async (c) => {
  const code = c.req.query("code");
  const state = c.req.query("state");
  if (!code) return apiError(c, 400, "invalid_request", "Missing authorization code");

  const clientId = c.env.GOOGLE_CLIENT_ID;
  const clientSecret = c.env.GOOGLE_CLIENT_SECRET;
  const baseUrl = c.env.WORKER_URL ?? "http://localhost:8787";
  const redirectUri = `${baseUrl}/api/auth/google/callback`;

  // Exchange code for access token
  const tokenResponse = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      code,
      grant_type: "authorization_code",
      redirect_uri: redirectUri,
    }),
  });
  const tokenData = await tokenResponse.json() as { access_token?: string };
  if (!tokenData.access_token) return apiError(c, 400, "oauth_error", "Failed to get access token");

  // Get user info
  const userResponse = await fetch("https://www.googleapis.com/oauth2/v2/userinfo", {
    headers: { Authorization: `Bearer ${tokenData.access_token}` },
  });
  const googleUser = await userResponse.json() as { email?: string; name?: string };
  if (!googleUser.email) return apiError(c, 400, "oauth_error", "Failed to get user info");
  const displayName = googleUser.name ?? googleUser.email;
  const memberRow = await findMemberByEmail(c, googleUser.email);
  if (!memberRow?.id) {
    return renderAuthNoticePage(c, {
      status: 403,
      title: "Sign-in not available",
      message: "This email address is not registered as a club member, so access cannot be granted.",
      hint: "If you believe this is a mistake, please ask a club administrator to confirm that your email has been added to the member register.",
    });
  }

  // Find or create auth user by email.
  let userRow = await c.env.DB.prepare("SELECT id, email, display_name, member_id FROM auth_users WHERE email = ?")
    .bind(googleUser.email.toLowerCase())
    .first<{ id: string; email: string; display_name: string; member_id: string | null }>();

  if (!userRow) {
    const id = newId("usr");
    const desiredRoles = new Set<string>(["member"]);
    if (isAdminEmail(c.env, googleUser.email)) {
      desiredRoles.add("admin");
    }

    await c.env.DB.prepare(
      "INSERT INTO auth_users (id, email, password_hash, password_salt, display_name, member_id, created_at) VALUES (?,?,?,?,?,?,?)"
    )
      .bind(id, googleUser.email.toLowerCase(), "GOOGLE_OAUTH", "GOOGLE_OAUTH", memberRow.full_name || displayName, memberRow.id, nowMs())
      .run();

    for (const role of Array.from(desiredRoles)) {
      await c.env.DB.prepare("INSERT INTO user_roles (user_id, role) VALUES (?, ?) ").bind(id, role).run();
    }

    userRow = {
      id,
      email: googleUser.email,
      display_name: memberRow.full_name || displayName,
      member_id: memberRow.id,
    };
  }

  const memberId = await ensureLinkedMemberId(c, userRow.id, userRow.email, userRow.member_id);
  const roles = await loadUserRoles(c.env, userRow.id);
  if (isAdminEmail(c.env, userRow.email) && !roles.includes("admin")) {
    await c.env.DB.prepare("INSERT INTO user_roles (user_id, role) VALUES (?, 'admin')").bind(userRow.id).run();
    roles.push("admin");
  }
  const effectiveRoles = roles.filter((role) => role !== "admin" || isAdminEmail(c.env, userRow.email));
  await c.env.DB.prepare("UPDATE auth_users SET last_login_at = ? WHERE id = ?").bind(nowMs(), userRow.id).run();

  const user = {
    id: userRow.id,
    email: userRow.email,
    displayName: memberRow.full_name || userRow.display_name,
    memberId,
    roles: effectiveRoles,
  };
  const token = await signJwt(user, c.env);
  const isProd = true; // Always use production cookie settings
  const cookie = sessionCookie(c.env, token, isProd);
  const redirectUrl = "https://crownzcom-club.pages.dev/app";

  return new Response(null, {
    status: 302,
    headers: {
      Location: redirectUrl,
      "Set-Cookie": cookie,
    },
  });
});
