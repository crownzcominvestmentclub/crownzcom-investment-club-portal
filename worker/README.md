# Crownzcom API — Cloudflare Worker

Backend for the Crownzcom Investment Club app. Owns:

- **D1** — relational database (members, savings, loans, ledger, etc.)
- **R2** — object storage for documents and avatars
- **Workers** — server-authoritative business logic (loan approvals, guarantor
  responses, repayment allocation, ledger writes)

The frontend (Cloudflare Pages) talks to this Worker through `src/lib/api.ts`
and `src/services/index.ts`. Set `VITE_API_BASE_URL` on Pages to this Worker's
URL (e.g. `https://crownzcom-api.workers.dev` or your custom domain).

## One-time setup

```bash
cd worker
bun install                  # or: npm install

# 1. Create the D1 database (copy the printed database_id into wrangler.toml)
bunx wrangler d1 create crownzcom

# 2. Apply schema + seed data locally
bunx wrangler d1 migrations apply crownzcom --local
bunx wrangler d1 execute crownzcom --local --file=./migrations/0002_seed.sql

# 3. Create the R2 bucket
bunx wrangler r2 bucket create crownzcom-files

# 4. Set the JWT signing secret
bunx wrangler secret put JWT_SECRET     # paste a long random string
```

## Develop

```bash
bunx wrangler dev            # http://127.0.0.1:8787
```

In the frontend `.env`:

```
VITE_API_BASE_URL=http://127.0.0.1:8787
```

## Deploy

```bash
bunx wrangler d1 migrations apply crownzcom --remote
bunx wrangler d1 execute crownzcom --remote --file=./migrations/0002_seed.sql
bunx wrangler deploy
```

## Architecture

| Layer        | What lives here                                                  |
|--------------|------------------------------------------------------------------|
| `src/index.ts` | Hono app, CORS, route mounting                                |
| `src/auth.ts`  | JWT issue/verify, password hashing, session cookies           |
| `src/middleware.ts` | `requireAuth`, `requireAdmin`, error envelope            |
| `src/db.ts`    | Tiny D1 helpers + typed row mappers                           |
| `src/routes/*` | One file per resource (members, savings, loans, …)            |
| `migrations/`  | SQL schema and seed                                           |

## Server-authoritative endpoints

These MUST run here, never on the client:

- `POST /api/loans/validate`
- `POST /api/loans` (long-term submission)
- `POST /api/loans/:id/final-approve`
- `POST /api/loans/:id/reject`
- `POST /api/loans/:id/repayments` (allocates borrower vs guarantor and writes ledger)
- `POST /api/guarantor-requests/:id/respond`
- `POST /api/savings/batch` (writes ledger entries in one transaction)
