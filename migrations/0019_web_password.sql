-- Authentication stays outside business datasets, exports and restores.
CREATE TABLE auth_credentials (
  singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
  source TEXT NOT NULL CHECK (source IN ('web', 'environment')),
  salt TEXT,
  verifier TEXT,
  CHECK (
    (source = 'environment' AND salt IS NULL AND verifier IS NULL)
    OR (source = 'web' AND salt IS NOT NULL AND verifier IS NOT NULL
      AND length(salt) = 64 AND length(verifier) = 64)
  )
);

-- Removing an existing deployment password must not reopen first-run setup.
INSERT INTO auth_credentials(singleton, source)
SELECT 1, 'environment'
WHERE EXISTS (SELECT 1 FROM auth_sessions)
   OR EXISTS (SELECT 1 FROM auth_login_limits);
