-- Dev-only convenience reset:
-- set all local auth accounts to password 12345678.
UPDATE auth_users
SET password_hash = 'SZTfOo5KaZa2ozfphAE6Yx71_VU_S6pVIj6DDD659DA',
    password_salt = 'hEEnYQOJAryPoWf2Cw7YJg'
WHERE COALESCE(provider, 'local') = 'local';
