-- Mentorship offers — an employer giving time rather than a placement.
--
-- Written to the same rule as 0001: invariants the domain layer enforces in
-- TypeScript are restated here as constraints, because a rule enforced in only
-- one of the two places is a rule the other will eventually violate.
--
-- The interesting thing about this table is what it does not have. No wage, no
-- hour cap, no credit hours, no timesheet, no foreign key to an application.
-- A mentorship is unpaid, uncredited, and never reimbursed, and giving it any
-- of those columns would invite the reimbursement and credit machinery to
-- attach to something that must not reach either. See src/domain/mentorship.ts.

BEGIN;

CREATE TYPE mentorship_format AS ENUM (
  'one_to_one', 'job_shadow', 'portfolio_review', 'group_session'
);

CREATE TYPE mentorship_offer_status AS ENUM ('open', 'paused', 'withdrawn');

CREATE TABLE mentorship_offers (
  id          text PRIMARY KEY,
  market_id   text NOT NULL REFERENCES markets(id) ON DELETE RESTRICT,
  business_id text NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  format      mentorship_format NOT NULL,

  -- The person a student would actually meet, and what they do. Required for
  -- the same reason a standard posting names a supervisor: an offer of
  -- mentorship from a company with nobody behind it is a logo, and a college
  -- cannot introduce a student to a logo.
  mentor_name text NOT NULL,
  mentor_role text NOT NULL,

  topics      text[] NOT NULL DEFAULT '{}',
  description text NOT NULL,

  -- Students this mentor will take at once. A declaration rather than a
  -- reservation — no pairing record exists for it to count against yet.
  capacity    integer NOT NULL DEFAULT 1,
  status      mentorship_offer_status NOT NULL DEFAULT 'open',

  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),

  -- Zero is not a pause. `paused` is a state the machine already has, and it
  -- is the one that can be reopened; a capacity of nobody would be a second,
  -- invisible way to be unavailable.
  CONSTRAINT capacity_positive CHECK (capacity > 0),
  CONSTRAINT mentor_is_named CHECK (
    length(trim(mentor_name)) > 0 AND length(trim(mentor_role)) > 0
  )
);

CREATE INDEX mentorship_offers_business_idx ON mentorship_offers (business_id);

-- The market's mentor list, which is the only read a student or college makes.
-- Partial because a paused or withdrawn offer is never shown: an employer who
-- paused and still appeared would field introductions they said they could not
-- take.
CREATE INDEX mentorship_offers_open_idx ON mentorship_offers (market_id)
  WHERE status = 'open';

COMMIT;
