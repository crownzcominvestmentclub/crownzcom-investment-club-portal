-- Crownzcom Investment Club — D1 schema
-- All monetary amounts are UGX, stored as INTEGER (no fractional shillings).

PRAGMA foreign_keys = ON;

-- ---------- Auth & roles ----------
CREATE TABLE auth_users (
  id              TEXT PRIMARY KEY,            -- ulid/uuid
  email           TEXT NOT NULL UNIQUE,
  password_hash   TEXT NOT NULL,               -- PBKDF2(SHA-256) base64
  password_salt   TEXT NOT NULL,
  display_name    TEXT NOT NULL,
  member_id       TEXT REFERENCES members(id) ON DELETE SET NULL,
  created_at      INTEGER NOT NULL,
  last_login_at   INTEGER
);

CREATE TABLE user_roles (
  user_id  TEXT NOT NULL REFERENCES auth_users(id) ON DELETE CASCADE,
  role     TEXT NOT NULL CHECK (role IN ('admin','member')),
  PRIMARY KEY (user_id, role)
);

-- ---------- Members ----------
CREATE TABLE members (
  id            TEXT PRIMARY KEY,
  full_name     TEXT NOT NULL,
  email         TEXT NOT NULL UNIQUE,
  phone         TEXT,
  status        TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','suspended','exited')),
  joined_at     INTEGER NOT NULL,
  notes         TEXT
);
CREATE INDEX idx_members_status ON members(status);

-- ---------- Savings (monthly contributions) ----------
CREATE TABLE savings (
  id            TEXT PRIMARY KEY,
  member_id     TEXT NOT NULL REFERENCES members(id) ON DELETE CASCADE,
  period_month  INTEGER NOT NULL,              -- 1..12
  period_year   INTEGER NOT NULL,
  amount        INTEGER NOT NULL,              -- UGX
  status        TEXT NOT NULL DEFAULT 'paid' CHECK (status IN ('paid','partial','missed')),
  paid_at       INTEGER,
  created_at    INTEGER NOT NULL,
  created_by    TEXT REFERENCES auth_users(id)
);
CREATE INDEX idx_savings_member ON savings(member_id, period_year, period_month);

-- ---------- Subscriptions (annual/monthly fees) ----------
CREATE TABLE subscriptions (
  id            TEXT PRIMARY KEY,
  member_id     TEXT NOT NULL REFERENCES members(id) ON DELETE CASCADE,
  period_year   INTEGER NOT NULL,
  amount        INTEGER NOT NULL,
  status        TEXT NOT NULL CHECK (status IN ('paid','due','overdue')),
  paid_at       INTEGER,
  created_at    INTEGER NOT NULL
);

-- ---------- Loans ----------
CREATE TABLE loans (
  id                  TEXT PRIMARY KEY,
  member_id           TEXT NOT NULL REFERENCES members(id) ON DELETE RESTRICT,
  type                TEXT NOT NULL CHECK (type IN ('short_term','long_term','emergency')),
  principal           INTEGER NOT NULL,
  interest_rate_pct   REAL NOT NULL,           -- monthly %
  term_months         INTEGER NOT NULL,
  purpose             TEXT,
  status              TEXT NOT NULL CHECK (status IN (
                        'pending','guarantors_pending','approved','active',
                        'completed','rejected','failed','defaulted'
                      )),
  outstanding         INTEGER NOT NULL DEFAULT 0,
  applied_at          INTEGER NOT NULL,
  approved_at         INTEGER,
  approved_by         TEXT REFERENCES auth_users(id),
  rejected_reason     TEXT,
  due_at              INTEGER
);
CREATE INDEX idx_loans_member ON loans(member_id);
CREATE INDEX idx_loans_status ON loans(status);

-- ---------- Loan guarantors ----------
CREATE TABLE loan_guarantors (
  id            TEXT PRIMARY KEY,
  loan_id       TEXT NOT NULL REFERENCES loans(id) ON DELETE CASCADE,
  guarantor_id  TEXT NOT NULL REFERENCES members(id) ON DELETE RESTRICT,
  amount        INTEGER NOT NULL,              -- pledged coverage in UGX
  status        TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','declined')),
  comment       TEXT,
  responded_at  INTEGER,
  created_at    INTEGER NOT NULL,
  UNIQUE (loan_id, guarantor_id)
);
CREATE INDEX idx_guarantor_pending ON loan_guarantors(guarantor_id, status);

-- ---------- Loan charges (fees, penalties) ----------
CREATE TABLE loan_charges (
  id          TEXT PRIMARY KEY,
  loan_id     TEXT NOT NULL REFERENCES loans(id) ON DELETE CASCADE,
  kind        TEXT NOT NULL CHECK (kind IN ('processing_fee','penalty','insurance','other')),
  amount      INTEGER NOT NULL,
  note        TEXT,
  created_at  INTEGER NOT NULL
);

-- ---------- Loan repayments ----------
CREATE TABLE loan_repayments (
  id                    TEXT PRIMARY KEY,
  loan_id               TEXT NOT NULL REFERENCES loans(id) ON DELETE CASCADE,
  amount                INTEGER NOT NULL,
  principal_portion     INTEGER NOT NULL DEFAULT 0,
  interest_portion      INTEGER NOT NULL DEFAULT 0,
  guarantor_portion     INTEGER NOT NULL DEFAULT 0,  -- portion that settles guarantor coverage
  paid_at               INTEGER NOT NULL,
  recorded_by           TEXT REFERENCES auth_users(id),
  created_at            INTEGER NOT NULL
);
CREATE INDEX idx_repayments_loan ON loan_repayments(loan_id);

-- ---------- Early repayment requests ----------
CREATE TABLE early_repayment_requests (
  id            TEXT PRIMARY KEY,
  loan_id       TEXT NOT NULL REFERENCES loans(id) ON DELETE CASCADE,
  member_id     TEXT NOT NULL REFERENCES members(id) ON DELETE CASCADE,
  amount        INTEGER NOT NULL,
  status        TEXT NOT NULL CHECK (status IN ('pending','approved','paid','cancelled')),
  requested_at  INTEGER NOT NULL,
  resolved_at   INTEGER
);

-- ---------- Expenses ----------
CREATE TABLE expenses (
  id          TEXT PRIMARY KEY,
  category    TEXT NOT NULL,
  amount      INTEGER NOT NULL,
  note        TEXT,
  incurred_at INTEGER NOT NULL,
  created_at  INTEGER NOT NULL,
  created_by  TEXT REFERENCES auth_users(id)
);

-- ---------- Unit trust ----------
CREATE TABLE unit_trust (
  id          TEXT PRIMARY KEY,
  kind        TEXT NOT NULL CHECK (kind IN ('deposit','withdrawal','interest')),
  amount      INTEGER NOT NULL,
  occurred_at INTEGER NOT NULL,
  note        TEXT,
  created_at  INTEGER NOT NULL
);

-- ---------- Documents (R2-backed) ----------
CREATE TABLE document_categories (
  id    TEXT PRIMARY KEY,
  name  TEXT NOT NULL UNIQUE
);

CREATE TABLE documents (
  id            TEXT PRIMARY KEY,
  category_id   TEXT REFERENCES document_categories(id) ON DELETE SET NULL,
  title         TEXT NOT NULL,
  object_key    TEXT NOT NULL,                  -- R2 key
  content_type  TEXT,
  size_bytes    INTEGER,
  uploaded_at   INTEGER NOT NULL,
  uploaded_by   TEXT REFERENCES auth_users(id)
);

-- ---------- General ledger ----------
CREATE TABLE ledger (
  id            TEXT PRIMARY KEY,
  occurred_at   INTEGER NOT NULL,
  account       TEXT NOT NULL,                  -- e.g. 'savings','loans_receivable','interest_income','expenses'
  direction     TEXT NOT NULL CHECK (direction IN ('debit','credit')),
  amount        INTEGER NOT NULL,
  ref_type      TEXT,                           -- 'savings','loan','repayment','expense',...
  ref_id        TEXT,
  memo          TEXT,
  created_at    INTEGER NOT NULL
);
CREATE INDEX idx_ledger_account ON ledger(account, occurred_at);
CREATE INDEX idx_ledger_ref     ON ledger(ref_type, ref_id);

-- ---------- Reports (materialised snapshots, optional) ----------
CREATE TABLE interest_monthly (
  id            TEXT PRIMARY KEY,
  period_month  INTEGER NOT NULL,
  period_year   INTEGER NOT NULL,
  amount        INTEGER NOT NULL,
  UNIQUE (period_year, period_month)
);

CREATE TABLE retained_earnings (
  id            TEXT PRIMARY KEY,
  period_year   INTEGER NOT NULL UNIQUE,
  amount        INTEGER NOT NULL
);

-- ---------- Financial config (single row) ----------
CREATE TABLE financial_config (
  id                          INTEGER PRIMARY KEY CHECK (id = 1),
  currency                    TEXT NOT NULL DEFAULT 'UGX',
  monthly_contribution        INTEGER NOT NULL DEFAULT 100000,
  short_term_rate_pct         REAL NOT NULL DEFAULT 5.0,
  long_term_rate_pct          REAL NOT NULL DEFAULT 3.0,
  loan_eligibility_pct        REAL NOT NULL DEFAULT 300.0, -- max loan as % of savings
  late_penalty_pct            REAL NOT NULL DEFAULT 2.0,
  updated_at                  INTEGER NOT NULL
);
