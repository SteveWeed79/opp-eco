-- What the host decided, which is the one fact only the employer knows.
--
-- The lifecycle records that the work was done and the credit granted, and
-- `outcomes` records where the learner went. Neither can hold whether the
-- employer who supervised the placement offered to keep them — the college
-- can tell you somebody is working, but what an employer decided about its own
-- headcount is not something it observes.
--
-- Three answers rather than two, and the middle one is why this table exists.
-- "We offered and they turned it down" and "we made no offer" are opposite
-- findings about a town: the first says the work is here and something else
-- won, the second says the work is not here. A programme asking why rural
-- graduates leave has to tell those apart, and collapsed into one boolean they
-- are not merely hard to separate but unrecoverable — separating them later
-- means asking an employer again about a placement that ended a year ago.
--
-- And a fourth state that is deliberately NOT a value in this table: nobody
-- has answered. That is the absence of a row, and it is the whole reason this
-- is a table rather than a column on `applications`. A three-valued column
-- puts the absence of an answer in the same field as the answers, one
-- mis-written query away from counting silence as "no offer" — which would
-- understate the programme by the size of its own admin backlog.

BEGIN;

CREATE TABLE host_offers (
  id text PRIMARY KEY,
  market_id text NOT NULL REFERENCES markets(id),

  -- One answer per placement, enforced here rather than in application code.
  -- An employer changing its mind is an edit to this row, not a second row:
  -- that is the opposite of `outcomes`, where a second row is a second
  -- follow-up and both are kept, because "where are they now" has a new answer
  -- every quarter and "did you offer them a job" does not.
  application_id text NOT NULL UNIQUE REFERENCES applications(id),

  -- Denormalised so the scoping rule can narrow a row to its author without a
  -- join through postings — the same reason `mentorship_pairings` carries it.
  business_id text NOT NULL REFERENCES organizations(id),
  student_id text NOT NULL REFERENCES students(id),

  -- text + CHECK rather than an enum, following `audit_events.entity_type` and
  -- `outcomes.kind` for the reason 0003 gives: an enum buys nothing a
  -- constraint does not and costs a two-transaction dance every time a value
  -- moves, because Postgres refuses to use an enum label in the transaction
  -- that added it.
  answer text NOT NULL,

  recorded_by text NOT NULL REFERENCES users(id),
  recorded_on timestamptz NOT NULL,

  -- The role that gave the answer, frozen at the moment it was recorded, for
  -- the reason `outcomes.source` gives: the source is part of the evidence.
  -- Here it separates an employer answering for itself from an administrator
  -- writing down what an employer said on the phone. Both are the employer's
  -- answer and only one is firsthand, and a report that cannot see the
  -- difference cannot tell a working process from a hand-worked one.
  source text NOT NULL,

  -- Why, when there was no offer. Optional on purpose: a required note is how
  -- a one-click answer becomes a form, and an employer who abandons the form
  -- tells you nothing at all.
  note text,

  CONSTRAINT host_offer_answer_known CHECK (
    answer IN ('accepted', 'declined', 'none')
  ),

  -- Only the two roles the domain allows may appear here. The service refuses
  -- the others too; this is the second lock, for the same reason every guard
  -- in this codebase is stated twice.
  CONSTRAINT host_offer_source_known CHECK (source IN ('business', 'admin'))
);

-- The administrator's chase queue is "finished placements with no row here",
-- which is an anti-join on application_id; the UNIQUE index above already
-- serves it. This one serves the employer's own list, which is the read that
-- happens on every visit to the business portal.
CREATE INDEX host_offers_by_business ON host_offers (business_id, recorded_on DESC);

-- Serves `forStudent`, which is how a learner's own portal finds the answer
-- about their own placement.
--
-- Note what this does NOT do: the retention purge removes a learner's direct
-- identifiers and does not reach the free text on observations — not here and
-- not on `outcomes.detail` either. An employer's note about a purged learner
-- survives the purge. That is the existing behaviour rather than something
-- this table introduces, and it is worth an explicit line because the obvious
-- assumption is the opposite.
CREATE INDEX host_offers_by_student ON host_offers (student_id);

COMMIT;
