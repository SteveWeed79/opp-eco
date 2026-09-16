-- A second factor for the accounts that can see everything.
--
-- A one-time code to a mailbox is single factor, and the factor is the mailbox.
-- For most roles here that is a proportionate trade: a learner's account reads
-- their own record. An administrator's reads every market, every learner, and
-- authorises money — so the account whose compromise is worst is the one with
-- the weakest thing standing in front of it.
--
-- **The secret below is stored recoverable, and that is a real departure from
-- everything else in this schema.** A sign-in code and a session token are held
-- as SHA-256 because the server only ever needs to *check* one. TOTP is a shared
-- secret: the server has to compute the same code the phone computes, so there
-- is no hash that would still work. What follows from that is worth being plain
-- about — a dump of this table is enough to generate second factors, so it
-- belongs behind encryption at rest rather than being treated as safe by virtue
-- of sitting next to the hashed things.

BEGIN;

CREATE TABLE user_totp (
  user_id      text PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  -- Base32, as the authenticator app was given it.
  secret       text NOT NULL,
  created_at   timestamptz NOT NULL DEFAULT now(),
  -- Null until the person has proved they can read a code from it. An
  -- unconfirmed enrolment must never be able to lock somebody out of their own
  -- account — that is a self-inflicted denial of service on the administrator.
  confirmed_at timestamptz,
  -- The counter of the last code accepted, so a code cannot be presented twice
  -- inside the window that still considers it valid. Shoulder-surfing a six
  -- digit number is not difficult; replaying it should be.
  last_counter bigint
);

-- The way back in from a lost phone. Without these, enrolling an administrator
-- in TOTP is a way to permanently lock out the only account that can fix it.
CREATE TABLE user_recovery_codes (
  id         text PRIMARY KEY,
  user_id    text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  -- SHA-256, like every other credential here: single use, and never stored in
  -- a form anybody could present.
  code_hash  text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  used_at    timestamptz
);

CREATE INDEX user_recovery_codes_user_idx ON user_recovery_codes (user_id)
  WHERE used_at IS NULL;

-- ---------------------------------------------------------------------------
-- The gap between the two factors
-- ---------------------------------------------------------------------------

-- Somebody who has proved the first factor and not yet the second.
--
-- A separate table rather than a flag on `sessions`, deliberately. A session row
-- is what `resolveSessionToken` turns into an actor, and a half-authenticated
-- row sitting in that table is one missed predicate away from being a working
-- login. Nothing resolves to an actor until both factors are in, so there is no
-- predicate to miss.
CREATE TABLE mfa_challenges (
  -- SHA-256 of the token in the cookie, exactly as sessions are held.
  id         text PRIMARY KEY,
  user_id    text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  attempts   integer NOT NULL DEFAULT 0,

  CONSTRAINT challenge_expires_after_creation CHECK (expires_at > created_at),
  CONSTRAINT challenge_attempts_non_negative CHECK (attempts >= 0)
);

CREATE INDEX mfa_challenges_expiry_idx ON mfa_challenges (expires_at);

COMMIT;
