-- Outcomes — the measure the lifecycle stopped short of.
--
-- Every other table here records whether a placement worked. None of them
-- records whether the venture did: the claim made to a funder is that a learner
-- who takes part is likelier to end up working in their own region, and until
-- this table there was nowhere to hold the answer either way.
--
-- Deliberately append-only in shape. There is no status column and no version,
-- because an outcome is an observation rather than a record that moves — a
-- learner followed up again six months later is a second row, and an UPDATE
-- would destroy the history that is the whole evidence.
--
-- Same rule as 0001 through 0003: invariants the domain enforces in TypeScript
-- are restated here, because a rule held in only one of the two places is one
-- the other will eventually break.

BEGIN;

-- Ordered as the domain orders them, strongest result first. `still_seeking` is
-- a recorded answer, not a blank: a learner who was asked and has not landed
-- anywhere is different evidence from a learner nobody followed up with, and
-- the second has no row at all.
CREATE TYPE outcome_kind AS ENUM (
  'employed_by_host',
  'employed_in_region',
  'employed_elsewhere',
  'continued_education',
  'entered_training',
  'still_seeking'
);

CREATE TABLE outcomes (
  id              text PRIMARY KEY,
  market_id       text NOT NULL REFERENCES markets(id) ON DELETE RESTRICT,
  student_id      text NOT NULL REFERENCES students(id) ON DELETE RESTRICT,
  -- Nullable on purpose, and not a shortcut. A learner reached through
  -- mentorship alone has no application, and the day career exposure that never
  -- became a placement is measured, that learner still has an outcome worth
  -- holding.
  application_id  text REFERENCES applications(id) ON DELETE RESTRICT,
  kind            outcome_kind NOT NULL,
  -- The date the outcome was true as of, which is not the day it was typed in.
  -- A follow-up made in March about a job that started in January is a January
  -- fact, and reporting that grouped it by the entry date would put it in the
  -- wrong quarter.
  observed_on     timestamptz NOT NULL,
  recorded_on     timestamptz NOT NULL DEFAULT now(),
  recorded_by     text NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  -- The role, frozen. Unlike `mentorship_pairings.introduced_by`, which stores
  -- only the user and lets the membership carry the role, because here the
  -- source *is* the evidence: an officer moving between organizations must not
  -- silently rewrite the weight of records they made years earlier.
  source          actor_role NOT NULL,
  detail          text,
  created_at      timestamptz NOT NULL DEFAULT now(),

  -- Nothing is observed after it is written down. A row failing this is a
  -- clock or a form bug, and it would land in a quarter that had not happened.
  CONSTRAINT observed_before_recorded CHECK (observed_on <= recorded_on),

  -- The board sees these with `detail` stripped, which is a read-side rule. It
  -- is restated as a comment rather than a policy because the platform has no
  -- row-level security yet; the narrowing lives in `outcomeScope` and
  -- `redactOutcome`, and this is the note for whoever adds RLS.
  CONSTRAINT detail_is_not_blank CHECK (detail IS NULL OR length(btrim(detail)) > 0)
);

-- The college's follow-up queue and the admin console's report, which are the
-- two reads, both ordered newest observation first.
CREATE INDEX outcomes_market_idx ON outcomes (market_id, observed_on DESC);
CREATE INDEX outcomes_student_idx ON outcomes (student_id, observed_on DESC);

-- The queue asks "does this application have an outcome yet" once per exited
-- placement, so that lookup must be cheap.
CREATE INDEX outcomes_application_idx ON outcomes (application_id)
  WHERE application_id IS NOT NULL;

-- One observation of a given kind, per learner, per experience, per date. A
-- second identical row is a double-submitted form rather than a second
-- follow-up — and `COALESCE` is required because a plain UNIQUE treats two
-- NULL application_ids as distinct, which is exactly the learner-level case
-- this needs to catch.
CREATE UNIQUE INDEX outcomes_no_duplicate_observation
  ON outcomes (student_id, COALESCE(application_id, ''), kind, observed_on);

COMMIT;
