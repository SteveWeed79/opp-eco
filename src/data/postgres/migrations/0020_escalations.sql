-- Escalations — the channel that goes around the other party.
--
-- The user story has always said "an escalation path exists on both tracks —
-- any party raises a problem, it routes to Admin," and nothing implemented it.
-- What stood in for it was the administrator's stuck-placement queue, derived
-- from how long an application has sat in one status. That can only see a
-- placement that has gone quiet; one going wrong loudly moves through its
-- statuses on time and looks healthy from every screen.
--
-- Three things this table is deliberately not:
--
--  * **Not an application status.** A placement in trouble is usually still
--    running. Folding it into the workflow would give every status an escalated
--    twin and make reporting a transition somebody could refuse.
--  * **Not readable by the parties it is about.** Enforced above this in
--    `escalationScope`, and stated here because a future reader adding a join
--    needs to know it was a decision: a learner who knows their supervisor will
--    read it does not report an absent supervisor.
--  * **Not a place for a resolution to be implied.** Closing one requires an
--    account of what was done, by CHECK below rather than by convention.

BEGIN;

-- Declaration order is the administrator's queue order — Postgres sorts an enum
-- by it, which is what lets safety come first without a CASE expression. The
-- domain's ESCALATION_KINDS is declared in this same order so the in-memory
-- layer agrees, and the parity suite compares them row for row.
CREATE TYPE escalation_kind AS ENUM (
  'safety', 'pay', 'hours', 'supervision', 'academic', 'other'
);

CREATE TYPE escalation_status AS ENUM (
  'open', 'acknowledged', 'resolved', 'withdrawn'
);

CREATE TABLE escalations (
  id                 text PRIMARY KEY,
  market_id          text NOT NULL REFERENCES markets(id) ON DELETE RESTRICT,
  application_id     text NOT NULL REFERENCES applications(id) ON DELETE RESTRICT,
  raised_by          text NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  -- The capacity it was raised in, stored rather than resolved through the
  -- membership at read time. A supervisor who later joins the college must not
  -- silently turn a complaint the employer made into one the college made.
  raised_by_role     actor_role NOT NULL,
  kind               escalation_kind NOT NULL,
  summary            text NOT NULL,
  raised_on          timestamptz NOT NULL DEFAULT now(),
  status             escalation_status NOT NULL DEFAULT 'open',
  acknowledged_on    timestamptz,
  acknowledged_by    text REFERENCES users(id) ON DELETE RESTRICT,
  resolution         text,
  resolved_on        timestamptz,
  version            integer NOT NULL DEFAULT 1,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now(),

  -- Whoever picks one up is recorded with when, or neither is.
  CONSTRAINT acknowledged_together CHECK (
    (acknowledged_on IS NULL) = (acknowledged_by IS NULL)
  ),

  -- "Resolved" with no account of what was done is the only record the
  -- platform will ever hold of this problem, and an empty one tells the next
  -- person nothing. The service says the same thing in a sentence; this is so
  -- it cannot be got around by a direct write.
  CONSTRAINT resolution_says_something CHECK (
    status <> 'resolved'
    OR (resolution IS NOT NULL AND length(btrim(resolution)) > 0 AND resolved_on IS NOT NULL)
  ),

  CONSTRAINT summary_is_not_blank CHECK (length(btrim(summary)) > 0)
);

-- The administrator's queue: everything still owed an answer, worst kind first
-- and oldest first within a kind. Partial, because a resolved escalation is
-- read when somebody asks what happened and never in the hot path.
CREATE INDEX escalations_live_idx
  ON escalations (market_id, kind, raised_on)
  WHERE status IN ('open', 'acknowledged');

-- A raiser reading their own, which is the only other query this table serves.
CREATE INDEX escalations_raiser_idx ON escalations (raised_by, raised_on DESC);

CREATE INDEX escalations_application_idx ON escalations (application_id);

COMMIT;
