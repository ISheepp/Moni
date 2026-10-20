-- Deployment authentication is independent of business datasets and backups.
CREATE TABLE auth_sessions (
  token_hash TEXT PRIMARY KEY,
  credential_hash TEXT NOT NULL,
  origin TEXT NOT NULL,
  expires_at INTEGER NOT NULL
);
CREATE INDEX auth_sessions_expiry ON auth_sessions(expires_at);

CREATE TABLE auth_login_limits (
  client_hash TEXT PRIMARY KEY,
  attempts INTEGER NOT NULL,
  reset_at INTEGER NOT NULL
);
CREATE INDEX auth_login_limits_expiry ON auth_login_limits(reset_at);
