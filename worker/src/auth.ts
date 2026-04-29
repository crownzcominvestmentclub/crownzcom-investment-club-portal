// Auth: PBKDF2 password hashing + HMAC-SHA256 signed JWTs.
// No external crypto deps — uses the Workers-native WebCrypto.

import type { Env, Role, SessionUser } from "./env";

// ---------- Password hashing (PBKDF2-SHA256, 100k iterations) ----------

const PBKDF2_ITER = 100_000;

function b64url(buf: ArrayBuffer | Uint8Array): string {
  const bytes = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function b64urlDecode(s: string): Uint8Array {
  s = s.replace(/-/g, "+").replace(/_/g, "/");
  while (s.length % 4) s += "=";
  const bin = atob(s);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export async function hashPassword(password: string, saltB64?: string): Promise<{ hash: string; salt: string }> {
  const salt = saltB64 ? b64urlDecode(saltB64) : crypto.getRandomValues(new Uint8Array(16));
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(password), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", hash: "SHA-256", salt, iterations: PBKDF2_ITER },
    key,
    256
  );
  return { hash: b64url(bits), salt: b64url(salt) };
}

export async function verifyPassword(password: string, hash: string, salt: string): Promise<boolean> {
  const { hash: candidate } = await hashPassword(password, salt);
  // constant-time compare
  if (candidate.length !== hash.length) return false;
  let diff = 0;
  for (let i = 0; i < candidate.length; i++) diff |= candidate.charCodeAt(i) ^ hash.charCodeAt(i);
  return diff === 0;
}

// ---------- JWT (HS256) ----------

interface JwtPayload extends SessionUser {
  iat: number;
  exp: number;
}

async function hmac(secret: string, data: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(data));
  return b64url(sig);
}

export async function signJwt(user: SessionUser, env: Env): Promise<string> {
  const ttl = parseInt(env.SESSION_TTL_SECONDS, 10) || 604800;
  const header = b64url(new TextEncoder().encode(JSON.stringify({ alg: "HS256", typ: "JWT" })));
  const payload: JwtPayload = { ...user, iat: Math.floor(Date.now() / 1000), exp: Math.floor(Date.now() / 1000) + ttl };
  const body = b64url(new TextEncoder().encode(JSON.stringify(payload)));
  const sig = await hmac(env.JWT_SECRET, `${header}.${body}`);
  return `${header}.${body}.${sig}`;
}

export async function verifyJwt(token: string, env: Env): Promise<SessionUser | null> {
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  const [h, p, s] = parts;
  const expect = await hmac(env.JWT_SECRET, `${h}.${p}`);
  if (expect !== s) return null;
  try {
    const payload = JSON.parse(new TextDecoder().decode(b64urlDecode(p))) as JwtPayload;
    if (payload.exp * 1000 < Date.now()) return null;
    return {
      id: payload.id,
      email: payload.email,
      displayName: payload.displayName,
      memberId: payload.memberId,
      roles: payload.roles,
    };
  } catch {
    return null;
  }
}

// ---------- Cookies ----------

export function sessionCookie(env: Env, token: string, isProd: boolean) {
  const ttl = parseInt(env.SESSION_TTL_SECONDS, 10) || 604800;
  const attrs = [
    `${env.SESSION_COOKIE_NAME}=${token}`,
    "Path=/",
    "HttpOnly",
    `Max-Age=${ttl}`,
    "SameSite=" + (isProd ? "None" : "Lax"),
  ];
  if (isProd) attrs.push("Secure");
  return attrs.join("; ");
}

export function clearSessionCookie(env: Env, isProd: boolean) {
  const attrs = [
    `${env.SESSION_COOKIE_NAME}=`,
    "Path=/",
    "HttpOnly",
    "Max-Age=0",
    "SameSite=" + (isProd ? "None" : "Lax"),
  ];
  if (isProd) attrs.push("Secure");
  return attrs.join("; ");
}

export function readCookie(req: Request, name: string): string | null {
  const h = req.headers.get("Cookie");
  if (!h) return null;
  for (const part of h.split(";")) {
    const [k, ...v] = part.trim().split("=");
    if (k === name) return v.join("=");
  }
  return null;
}

// ---------- Roles ----------

export async function loadUserRoles(env: Env, userId: string): Promise<Role[]> {
  const rows = await env.DB.prepare("SELECT role FROM user_roles WHERE user_id = ?").bind(userId).all<{ role: Role }>();
  return (rows.results ?? []).map((r) => r.role);
}
