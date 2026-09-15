-- Real sign-on: server-side sessions, one-time codes, and no password anywhere.
--
-- Sign-on was a cookie holding a role string — you asked to be a board officer
-- and you were one. Everything downstream was already the real shape, so this
-- replaces the one part that was theatre.
--
-- **There is no credential column in this file, and that is deliberate.** One
-- set of users here are public employees, and the data rules say to federate a
-- government identity rather than replicate it: a credential this platform does
-- not hold is one it cannot leak, phish or have replayed. What it holds instead
-- is a hash of a short-lived code and a hash of a session token, neither of
-- which can be turned back into something presentable.
--
-- Note what is NOT stored on a session: no IP address, no user agent, no device
-- fingerprint. Every stored field has to trace to a decision someone makes on
-- screen, and nothing in this product shows a person their session list. The
-- day it does, those columns arrive with the screen that needs them.

BEGIN;

CREATE TYPE identity_mode AS ENUM ('email_code', 'federated');

-- How an organization's people prove who they are. On the organization because
-- it is an institutional decision: a workforce board does not let some officers
-- federate and others pick a password.
ALTER TABLE organizations
  ADD COLUMN identity_mode identity_mode NOT NULL DEFAULT 'email_code';

-- Work-address domains. Empty accepts whatever address is already on the user
-- record; populated, it is what stops a public employee's account being bound
-- to a personal mailbox their agency cannot revoke.
ALTER TABLE organizations
  ADD COLUMN email_domains text[] NOT NULL DEFAULT '{}';

-- ---------------------------------------------------------------------------
-- Sessions
-- ---------------------------------------------------------------------------

CREATE TABLE sessions (
  -- The SHA-256 of the token in the cookie, never the token. A dump of this
  -- table yields nothing anyone can present.
  id           text PRIMARY KEY,
  user_id      text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at   timestamptz NOT NULL DEFAULT now(),
  -- Hard stop regardless of activity. The idle window is enforced in the
  -- domain against `last_seen_at`, because it varies by role and a column
  -- cannot know the role without a join the resolver would pay for on every
  -- request.
  expires_at   timestamptz NOT NULL,
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  revoked_at   timestamptz,

  CONSTRAINT session_expires_after_creation CHECK (expires_at > created_at)
);

-- Sign-out revokes rather than deletes, so the sweep below is what actually
-- removes rows. Expired sessions are worthless but not free.
CREATE INDEX sessions_user_idx ON sessions (user_id) WHERE revoked_at IS NULL;
CREATE INDEX sessions_expiry_idx ON sessions (expires_at);

-- ---------------------------------------------------------------------------
-- One-time codes
-- ---------------------------------------------------------------------------

-- Keyed by user rather than given an id of its own: requesting a new code
-- replaces the outstanding one, so a person who clicks twice cannot leave two
-- live codes behind and nobody can accumulate guesses across several.
CREATE TABLE sign_in_codes (
  user_id     text PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  -- The code is never stored. The platform can check one and cannot reproduce
  -- one, which matters because an unconsumed code is a bearer token.
  code_hash   text NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  expires_at  timestamptz NOT NULL,
  attempts    integer NOT NULL DEFAULT 0,
  consumed_at timestamptz,

  CONSTRAINT code_expires_after_creation CHECK (expires_at > created_at),
  CONSTRAINT attempts_non_negative CHECK (attempts >= 0)
);

CREATE INDEX sign_in_codes_expiry_idx ON sign_in_codes (expires_at);

COMMIT;
