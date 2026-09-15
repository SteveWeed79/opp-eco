-- Introductions — the half of mentorship that was never recorded.
--
-- An offer said an employer would take two students at once; nothing said who
-- those students were, so `capacity` was a number no query could check and a
-- mentorship could not count toward the outcome this platform claims to
-- measure. The pairing was happening off-platform, which meant it was
-- happening in a college officer's inbox.
--
-- Same rule as 0001 and 0002: invariants the domain enforces in TypeScript are
-- restated here, because a rule held in only one of the two places is one the
-- other will eventually break.

BEGIN;

-- Nothing to add to `audit_events`: its `entity_type` is text rather than an
-- enum, so a new kind of audited thing needs no migration to be auditable.

CREATE TYPE mentorship_pairing_status AS ENUM ('introduced', 'met', 'declined');

CREATE TABLE mentorship_pairings (
  id                    text PRIMARY KEY,
  market_id             text NOT NULL REFERENCES markets(id) ON DELETE RESTRICT,
  offer_id              text NOT NULL REFERENCES mentorship_offers(id) ON DELETE RESTRICT,
  -- Denormalised from the offer so the scoping rule that narrows an employer to
  -- its own introductions needs no join, exactly as `time_entries` carries it.
  business_id           text NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  student_id            text NOT NULL REFERENCES students(id) ON DELETE RESTRICT,
  -- Never the student and never the employer: the college or an administrator.
  -- The role is not stored because the membership behind the user carries it,
  -- and a second copy would be the one that goes stale.
  introduced_by         text NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  introduced_on         timestamptz NOT NULL DEFAULT now(),
  status                mentorship_pairing_status NOT NULL DEFAULT 'introduced',
  outcome_note          text,
  outcome_on            timestamptz,
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now(),

  -- A closed pairing says when it closed, and a live one has not. Without this
  -- an introduction can report an outcome that never has a date against it,
  -- which is the shape of record an auditor asks about.
  CONSTRAINT outcome_is_complete CHECK (
    (status = 'introduced') = (outcome_on IS NULL)
  )
);

-- The employer's queue and the college's list, which are the two reads.
CREATE INDEX mentorship_pairings_business_idx
  ON mentorship_pairings (business_id, introduced_on DESC);
CREATE INDEX mentorship_pairings_student_idx ON mentorship_pairings (student_id);

-- Capacity is counted per offer over the live ones, so that count must be cheap.
CREATE INDEX mentorship_pairings_live_idx ON mentorship_pairings (offer_id)
  WHERE status = 'introduced';

-- One live introduction per student per offer. A second while the first is
-- still open is a double-booked place rather than a second mentorship; once the
-- first has closed, the same pair may be introduced again, which is why this is
-- partial rather than a plain unique constraint.
CREATE UNIQUE INDEX mentorship_pairings_one_live_per_pair
  ON mentorship_pairings (offer_id, student_id)
  WHERE status = 'introduced';

COMMIT;
