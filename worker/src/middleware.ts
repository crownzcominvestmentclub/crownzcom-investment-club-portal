// Hono middleware: CORS, error envelope, auth, role gates.

import type { Context, Next } from "hono";
import type { Env, SessionUser } from "./env";
import { readCookie, verifyJwt } from "./auth";

export type AppContext = {
  Bindings: Env;
  Variables: { user?: SessionUser };
};

export function corsMiddleware() {
  return async (c: Context<AppContext>, next: Next) => {
    const origin = c.req.header("Origin") ?? "";
    const allowed = (c.env.ALLOWED_ORIGINS || "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    const allowOrigin = allowed.includes(origin) ? origin : allowed[0] ?? "*";

    if (c.req.method === "OPTIONS") {
      return new Response(null, {
        status: 204,
        headers: {
          "Access-Control-Allow-Origin": allowOrigin,
          "Access-Control-Allow-Credentials": "true",
          "Access-Control-Allow-Methods": "GET,POST,PUT,PATCH,DELETE,OPTIONS",
          "Access-Control-Allow-Headers": "Content-Type, Authorization",
          "Access-Control-Max-Age": "86400",
          Vary: "Origin",
        },
      });
    }

    await next();
    c.res.headers.set("Access-Control-Allow-Origin", allowOrigin);
    c.res.headers.set("Access-Control-Allow-Credentials", "true");
    c.res.headers.set("Vary", "Origin");
  };
}

export async function loadSession(c: Context<AppContext>, next: Next) {
  const auth = c.req.header("Authorization");
  let token: string | null = null;
  if (auth?.startsWith("Bearer ")) token = auth.slice(7);
  if (!token) token = readCookie(c.req.raw, c.env.SESSION_COOKIE_NAME);
  if (token) {
    const user = await verifyJwt(token, c.env);
    if (user) c.set("user", user);
  }
  await next();
}

export async function requireAuth(c: Context<AppContext>, next: Next) {
  if (!c.get("user")) return c.json({ code: "unauthenticated", message: "Sign in required" }, 401);
  await next();
}

export function requireRole(role: "admin" | "member") {
  return async (c: Context<AppContext>, next: Next) => {
    const u = c.get("user");
    if (!u) return c.json({ code: "unauthenticated", message: "Sign in required" }, 401);
    if (!u.roles.includes(role)) return c.json({ code: "forbidden", message: "Insufficient role" }, 403);
    await next();
  };
}

export function apiError(c: Context<AppContext>, status: number, code: string, message: string, details?: unknown) {
  return c.json({ code, message, details }, status as 400 | 401 | 403 | 404 | 500);
}
