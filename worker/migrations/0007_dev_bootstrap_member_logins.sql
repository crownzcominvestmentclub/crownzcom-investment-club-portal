-- Dev-only convenience bootstrap:
-- ensure every member with an email can sign in locally with password 12345678.
--
-- This migration:
-- 1. updates existing auth users for matching member emails to use a shared local dev password
-- 2. creates missing local auth users for members who only exist in the members table
-- 3. assigns the member role to any newly created auth users

PRAGMA foreign_keys = ON;

-- Reset existing accounts for member emails (including previously Google-created rows)
-- so email/password sign-in works consistently in dev.
UPDATE auth_users
SET password_hash = 'SZTfOo5KaZa2ozfphAE6Yx71_VU_S6pVIj6DDD659DA',
    password_salt = 'hEEnYQOJAryPoWf2Cw7YJg',
    provider = 'local'
WHERE lower(email) IN (
  SELECT lower(email)
  FROM members
  WHERE email IS NOT NULL AND trim(email) <> ''
);

-- Create missing local auth accounts for members who do not yet have one.
INSERT INTO auth_users (
  id,
  email,
  password_hash,
  password_salt,
  display_name,
  member_id,
  created_at,
  provider
)
SELECT
  'usr_' || member.id,
  lower(member.email),
  'SZTfOo5KaZa2ozfphAE6Yx71_VU_S6pVIj6DDD659DA',
  'hEEnYQOJAryPoWf2Cw7YJg',
  member.full_name,
  member.id,
  CAST(strftime('%s','now') AS INTEGER) * 1000,
  'local'
FROM members AS member
LEFT JOIN auth_users AS auth
  ON lower(auth.email) = lower(member.email)
WHERE member.email IS NOT NULL
  AND trim(member.email) <> ''
  AND auth.id IS NULL;

-- Ensure new auth users can sign in as members.
INSERT OR IGNORE INTO user_roles (user_id, role)
SELECT auth.id, 'member'
FROM auth_users AS auth
JOIN members AS member
  ON lower(auth.email) = lower(member.email)
WHERE member.email IS NOT NULL
  AND trim(member.email) <> '';
