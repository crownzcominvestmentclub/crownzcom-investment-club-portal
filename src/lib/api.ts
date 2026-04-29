// Cloudflare Workers API client.
//
// Architecture:
//   - Frontend (Cloudflare Pages) talks to a Cloudflare Worker over HTTPS.
//   - The Worker owns D1 (database) and R2 (object storage), and runs all
//     server-authoritative logic (loan approvals, guarantor responses,
//     repayment allocation, ledger writes).
//   - Authentication: the Worker issues a session token (e.g. signed JWT in an
//     httpOnly cookie or Bearer token) on login. We send credentials with every
//     request so the cookie flows automatically; a Bearer fallback is supported
//     via `setAuthToken()` for environments where cookies aren't usable.
//
// Conventions:
//   - All endpoints live under `${VITE_API_BASE_URL}/api/*`.
//   - JSON in / JSON out. Non-2xx responses throw `ApiError`.
//   - File uploads use a 2-step flow: POST /api/uploads/sign → PUT to R2 signed URL.

const BASE_URL = (import.meta.env.VITE_API_BASE_URL as string | undefined)?.replace(/\/$/, "") ?? "";

let authToken: string | null = null;

/** Set a Bearer token (alternative to cookie auth). Pass `null` to clear. */
export function setAuthToken(token: string | null) {
  authToken = token;
}

export class ApiError extends Error {
  constructor(public status: number, public code: string, message: string, public details?: unknown) {
    super(message);
    this.name = "ApiError";
  }
}

interface RequestOptions {
  method?: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  body?: unknown;
  query?: Record<string, string | number | boolean | undefined>;
  signal?: AbortSignal;
}

async function request<T>(path: string, opts: RequestOptions = {}): Promise<T> {
  const { method = "GET", body, query, signal } = opts;

  const url = new URL((BASE_URL || "") + path, typeof window !== "undefined" ? window.location.origin : "http://localhost");
  if (query) {
    for (const [k, v] of Object.entries(query)) {
      if (v !== undefined && v !== null) url.searchParams.set(k, String(v));
    }
  }

  const headers: Record<string, string> = { Accept: "application/json" };
  if (body !== undefined) headers["Content-Type"] = "application/json";
  if (authToken) headers.Authorization = `Bearer ${authToken}`;

  const res = await fetch(url.toString(), {
    method,
    headers,
    credentials: "include",
    body: body !== undefined ? JSON.stringify(body) : undefined,
    signal,
  });

  if (!res.ok) {
    let payload: { code?: string; message?: string; details?: unknown } = {};
    try {
      payload = await res.json();
    } catch {
      // ignore
    }
    throw new ApiError(
      res.status,
      payload.code ?? `http_${res.status}`,
      payload.message ?? res.statusText,
      payload.details
    );
  }

  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

export const api = {
  get: <T>(path: string, query?: RequestOptions["query"]) => request<T>(path, { method: "GET", query }),
  post: <T>(path: string, body?: unknown) => request<T>(path, { method: "POST", body }),
  put: <T>(path: string, body?: unknown) => request<T>(path, { method: "PUT", body }),
  patch: <T>(path: string, body?: unknown) => request<T>(path, { method: "PATCH", body }),
  delete: <T>(path: string, body?: unknown) => request<T>(path, { method: "DELETE", body }),
};

// ---------- R2 file upload helper ----------
//
// Worker route: POST /api/uploads/sign
//   body: { filename: string, contentType: string, scope?: "documents" | "avatars" | ... }
//   returns: { uploadUrl: string, objectKey: string, publicUrl?: string, expiresIn: number }
//
// Then the browser PUTs the file directly to `uploadUrl`. The Worker can later
// resolve `objectKey` against the R2 binding to read or generate signed download URLs.

export interface SignedUpload {
  uploadUrl: string;
  objectKey: string;
  publicUrl?: string;
  expiresIn: number;
}

export async function uploadToR2(file: File, scope = "documents"): Promise<SignedUpload> {
  const signed = await api.post<SignedUpload>("/api/uploads/sign", {
    filename: file.name,
    contentType: file.type || "application/octet-stream",
    scope,
  });

  const put = await fetch(signed.uploadUrl, {
    method: "PUT",
    headers: { "Content-Type": file.type || "application/octet-stream" },
    body: file,
  });
  if (!put.ok) throw new ApiError(put.status, "r2_upload_failed", `R2 upload failed (${put.status})`);

  return signed;
}

/** Request a short-lived signed download URL for a private R2 object. */
export function getSignedDownloadUrl(objectKey: string) {
  return api.post<{ url: string; expiresIn: number }>("/api/uploads/sign-download", { objectKey });
}

/** True when the API base URL hasn't been configured — service layer falls back to seed data. */
export const isApiConfigured = () => Boolean(BASE_URL);
