-- Deliverables — the micro track's unit of work, and its assessment.
--
-- `applications.deliverable_submitted` has guarded the employer's "Accept
-- deliverable" transition since the first migration, and
-- `deliverable_accepted` decides whether a micro posting's hours count toward
-- a credit. Both were written only by the seed, so the track had a gate nobody
-- could open and a credit rule nothing could satisfy.
--
-- Those two columns stay where they are. They are the current state the state
-- machine and the credit calculation read, both of which are pure functions of
-- an application; this table is the history behind them, and the service writes
-- both in one transaction. Denormalised deliberately — see `Deliverable` in
-- domain/types.ts, which says so at greater length.
--
-- What the columns cannot hold is why this table exists: the employer's words.
-- Acceptance *is* the evaluation on this track, so the note is an academic
-- record a registrar may be asked about, and a revision ask is the only
-- instruction the learner gets.

BEGIN;

CREATE TYPE deliverable_status AS ENUM (
  'submitted', 'revision_requested', 'accepted'
);

CREATE TABLE deliverables (
  id                  text PRIMARY KEY,
  market_id           text NOT NULL REFERENCES markets(id) ON DELETE RESTRICT,
  application_id      text NOT NULL REFERENCES applications(id) ON DELETE RESTRICT,
  student_id          text NOT NULL REFERENCES students(id) ON DELETE RESTRICT,
  summary             text NOT NULL,
  -- The uploaded file, or null where the work is a link or a written brief.
  -- No foreign key to `uploaded_files`: that table is the file store's, keyed
  -- by an opaque key, and retrieval already re-checks authorization on every
  -- request rather than trusting a reference.
  file_key            text,
  submitted_on        timestamptz NOT NULL DEFAULT now(),
  status              deliverable_status NOT NULL DEFAULT 'submitted',
  response            text,
  responded_on        timestamptz,
  responded_by        text REFERENCES users(id) ON DELETE RESTRICT,
  -- 1 for the first hand-in, 2 after one revision. A round rather than a second
  -- row, because "the third version" is a number a college wants to read and a
  -- chain of rows makes it a join.
  round               integer NOT NULL DEFAULT 1,
  version             integer NOT NULL DEFAULT 1,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),

  -- Whoever answered is recorded with when and what, or none of the three is.
  CONSTRAINT response_is_whole CHECK (
    (status = 'submitted' AND response IS NULL AND responded_on IS NULL AND responded_by IS NULL)
    OR (status <> 'submitted' AND responded_on IS NOT NULL AND responded_by IS NOT NULL)
  ),

  -- An acceptance with no words is the entire academic record of a
  -- credit-bearing placement. The service says the same thing in a sentence;
  -- this is so a direct write cannot get around it.
  CONSTRAINT acceptance_says_something CHECK (
    status <> 'accepted' OR (response IS NOT NULL AND length(btrim(response)) > 0)
  ),

  CONSTRAINT summary_is_not_blank CHECK (length(btrim(summary)) > 0),
  CONSTRAINT round_is_positive CHECK (round >= 1)
);

-- One deliverable per application. A resubmission is a new round on this row,
-- not a second row — which is what makes `round` meaningful and what stops a
-- learner starting two clocks on the same employer.
CREATE UNIQUE INDEX deliverables_one_per_application ON deliverables (application_id);

-- The employer's queue: hand-ins still waiting on an answer, oldest first.
CREATE INDEX deliverables_awaiting_idx
  ON deliverables (market_id, submitted_on)
  WHERE status = 'submitted';

CREATE INDEX deliverables_student_idx ON deliverables (student_id);

COMMIT;
