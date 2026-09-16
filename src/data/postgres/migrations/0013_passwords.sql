-- Passwords, for the people the government rule was never about.
--
-- Colleges, employers and learners sign in with an address and a password.
-- Government organizations do not, and that is the line worth being precise
-- about: **this platform still holds no password for a public employee.** A
-- board officer proves a one-time code to their work address and a second
-- factor from an app. The only secret stored for them is a TOTP seed, which is
-- not a reusable credential and cannot be presented anywhere else.
--
-- The hash format lives in `src/domain/password.ts` and carries its own
-- parameters, so the column is deliberately plain text of a self-describing
-- value rather than a set of columns this migration would have to keep in step.

BEGIN;

CREATE TABLE user_passwords (
  user_id       text PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  -- `scrypt$N$r$p$salt$key`. Self-describing, so raising the cost later is a
  -- rehash on next sign-in rather than a migration that locks everybody out.
  password_hash text NOT NULL,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  -- Set when somebody other than the owner put this password here — an
  -- administrator restoring access to an account whose mailbox changed. They
  -- choose their own before doing anything else, so a temporary credential
  -- cannot quietly become a permanent one.
  must_change   boolean NOT NULL DEFAULT false
);

-- ---------------------------------------------------------------------------
-- One-time codes gain a purpose
-- ---------------------------------------------------------------------------

-- A code emailed to prove an address is not a code emailed to reset a password,
-- and until now there was nothing in the row to tell them apart. Without this,
-- a sign-in code intercepted or shoulder-surfed could be spent as a reset, and
-- a reset code could be spent as a sign-in — neither of which anybody intended
-- when they asked for one.
ALTER TABLE sign_in_codes ADD COLUMN purpose text NOT NULL DEFAULT 'sign_in';

ALTER TABLE sign_in_codes
  ADD CONSTRAINT code_purpose_known CHECK (purpose IN ('sign_in', 'password_reset'));

-- Keyed by person *and* purpose, so asking to reset a password does not
-- silently invalidate the sign-in code somebody is already holding.
ALTER TABLE sign_in_codes DROP CONSTRAINT sign_in_codes_pkey;
ALTER TABLE sign_in_codes ADD PRIMARY KEY (user_id, purpose);

-- ---------------------------------------------------------------------------
-- Who signs in how
-- ---------------------------------------------------------------------------

-- Colleges and employers, and by extension the learners whose membership points
-- at their college.
UPDATE organizations SET identity_mode = 'password'
  WHERE kind IN ('college', 'business');

-- Government organizations move off `federated` and onto a code plus a required
-- second factor. Federation is still the destination; it is not a thing that
-- exists yet, and until an adapter ships, `federated` means a board officer
-- cannot use the platform at all. A pilot that locks out the agency determining
-- eligibility has not been made safer, it has been made useless.
UPDATE organizations SET identity_mode = 'email_code' WHERE kind = 'board';

COMMIT;
