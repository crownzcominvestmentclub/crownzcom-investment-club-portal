// Cloudflare Worker bindings + shared types.
//
// Bindings come from wrangler.toml and (for secrets) `wrangler secret put`.

export interface Env {
  DB: D1Database;
  BUCKET: R2Bucket;
  // KV?: KVNamespace;

  // vars
  ALLOWED_ORIGINS: string;
  SESSION_COOKIE_NAME: string;
  SESSION_TTL_SECONDS: string;
  EMAIL_PASSWORD_SIGNIN_ENABLED?: string;
  ADMIN_EMAILS?: string;
  WORKER_URL?: string;

  // secrets
  JWT_SECRET: string;
  GOOGLE_CLIENT_ID: string;
  GOOGLE_CLIENT_SECRET: string;
}

export type Role = "admin" | "member";

export interface SessionUser {
  id: string;
  email: string;
  displayName: string;
  memberId: string | null;
  roles: Role[];
}
