-- Minimal seed so the API is browseable end-to-end.
-- For richer demo data, run a script that mirrors src/data/seed.ts.

INSERT OR IGNORE INTO financial_config (id, currency, monthly_contribution, short_term_rate_pct, long_term_rate_pct, loan_eligibility_pct, late_penalty_pct, updated_at)
VALUES (1, 'UGX', 100000, 5.0, 3.0, 300.0, 2.0, strftime('%s','now')*1000);

INSERT OR IGNORE INTO document_categories (id, name) VALUES
  ('cat_constitution','Constitution'),
  ('cat_minutes','Minutes'),
  ('cat_policies','Policies'),
  ('cat_statements','Statements');

-- Demo admin (password: "admin1234"). Replace in production.
-- password_hash + salt are placeholders; the Worker will rehash on first
-- login attempt if you call /api/auth/dev-bootstrap (disabled by default).
INSERT OR IGNORE INTO members (id, full_name, email, phone, status, joined_at)
VALUES ('mem_admin','Club Administrator','admin@crownzcom.ug','+256700000000','active', strftime('%s','now')*1000);

INSERT OR IGNORE INTO auth_users (id, email, password_hash, password_salt, display_name, member_id, created_at)
VALUES ('usr_admin','admin@crownzcom.ug','SEED_REHASH_ON_LOGIN','SEED','Club Administrator','mem_admin', strftime('%s','now')*1000);

INSERT OR IGNORE INTO user_roles (user_id, role) VALUES
  ('usr_admin','admin'),
  ('usr_admin','member');
