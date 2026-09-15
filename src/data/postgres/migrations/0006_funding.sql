-- Funding — many sources, one placement.
--
-- Until now a market carried `subsidy_budget_cents` and `subsidy_rate_cents`
-- directly: one workforce board, one allocation, one hourly rate. That is the
-- mechanic the Southeast Kansas pilot runs on, and it is not the thing the
-- venture sells. What it sells is funding coordination — a board's wage
-- subsidy, a foundation's grant toward the cost of internship credit, a
-- college's fee waiver, an employer's own contribution — and none of the
-- second, third or fourth was expressible.
--
-- The two columns are dropped here rather than kept in step. A figure written
-- in one place and read in five is what this schema avoids everywhere else, and
-- a market's allocation is now the balance of its wage-subsidy source.
--
-- Same rule as 0001 through 0005: invariants the domain enforces in TypeScript
-- are restated here, because a rule held in only one of the two places is one
-- the other will eventually break.

BEGIN;

CREATE TYPE fund_kind AS ENUM (
  'workforce', 'philanthropic', 'institutional', 'employer'
);

-- Separate from the kind, because a foundation can pay a wage or a bus fare and
-- a college can waive a fee or fund a stipend. Collapsing them would mean a new
-- kind of sponsor every time a new cost appears.
CREATE TYPE fund_purpose AS ENUM (
  'wage_subsidy', 'credit_cost', 'transportation', 'stipend', 'employer_support'
);

CREATE TYPE funding_source_status AS ENUM ('active', 'exhausted', 'closed');
CREATE TYPE commitment_status AS ENUM ('authorized', 'disbursed', 'released');

CREATE TABLE funding_sources (
  id              text PRIMARY KEY,
  market_id       text NOT NULL REFERENCES markets(id) ON DELETE RESTRICT,
  -- Whoever the money belongs to. A board, a foundation, a college — which is
  -- why 0005 had to add 'nonprofit' before this table could exist.
  sponsor_org_id  text NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  kind            fund_kind NOT NULL,
  purpose         fund_purpose NOT NULL,
  program_year    text NOT NULL,
  name            text NOT NULL,
  -- Money in cents, as everywhere else here. Floating-point dollars in a system
  -- that reports to a funder is how reconciliations stop reconciling.
  allocated_cents bigint NOT NULL DEFAULT 0,
  rate_cents      integer,
  status          funding_source_status NOT NULL DEFAULT 'active',
  opened_on       timestamptz NOT NULL DEFAULT now(),
  -- An allocation has more than one desk: a board officer adjusting an award
  -- and an administrator correcting a figure are the concurrent write this
  -- catches, and the loser overwriting a supplemental award with a stale number
  -- is a funder-facing error.
  version         integer NOT NULL DEFAULT 1,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT allocation_non_negative CHECK (allocated_cents >= 0),
  -- A rate on a fund that does not pay by the hour is a number nothing would
  -- ever multiply. Only a wage subsidy may carry one.
  CONSTRAINT rate_only_where_hourly CHECK (
    purpose = 'wage_subsidy' OR rate_cents IS NULL
  ),
  CONSTRAINT rate_positive CHECK (rate_cents IS NULL OR rate_cents > 0)
);

-- `wageSubsidySource` picks *the* wage fund for a market and would silently
-- take the first of several. This is what makes that honest.
CREATE UNIQUE INDEX funding_sources_one_wage_subsidy
  ON funding_sources (market_id, program_year)
  WHERE purpose = 'wage_subsidy' AND status <> 'closed';

CREATE INDEX funding_sources_market_idx
  ON funding_sources (market_id, purpose);

CREATE TABLE funding_commitments (
  id                text PRIMARY KEY,
  market_id         text NOT NULL REFERENCES markets(id) ON DELETE RESTRICT,
  funding_source_id text NOT NULL REFERENCES funding_sources(id) ON DELETE RESTRICT,
  student_id        text NOT NULL REFERENCES students(id) ON DELETE RESTRICT,
  -- Nullable on purpose. A transport grant or a fee waiver can reach a learner
  -- who has not been placed yet, and refusing to record it until they are is
  -- how the barrier stays invisible.
  application_id    text REFERENCES applications(id) ON DELETE RESTRICT,
  amount_cents      bigint NOT NULL,
  hours             numeric(8,2),
  -- Copied from the source at authorization, never read through it. A board
  -- moving next year's cohort from $20 to $18 must not retroactively rewrite
  -- what it already committed at $20.
  rate_cents        integer,
  status            commitment_status NOT NULL DEFAULT 'authorized',
  authorized_on     timestamptz NOT NULL DEFAULT now(),
  authorized_by     text NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  note              text,
  version           integer NOT NULL DEFAULT 1,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT amount_positive CHECK (amount_cents > 0),
  CONSTRAINT hours_non_negative CHECK (hours IS NULL OR hours >= 0),
  CONSTRAINT note_is_not_blank CHECK (note IS NULL OR length(btrim(note)) > 0)
);

-- Every balance in the product counts live commitments per source, so that
-- count must be cheap.
CREATE INDEX funding_commitments_source_idx
  ON funding_commitments (funding_source_id)
  WHERE status <> 'released';

CREATE INDEX funding_commitments_application_idx
  ON funding_commitments (application_id)
  WHERE application_id IS NOT NULL;

CREATE INDEX funding_commitments_student_idx
  ON funding_commitments (student_id);

-- One live draw per fund per placement. A placement may draw on a wage subsidy
-- AND a credit-cost grant — that is the entire point of this change — but
-- drawing twice on the same fund is a double commitment rather than a second
-- kind of help. Partial, so a released commitment can be followed by a new one.
CREATE UNIQUE INDEX funding_commitments_one_live_per_source_application
  ON funding_commitments (funding_source_id, application_id)
  WHERE application_id IS NOT NULL AND status <> 'released';

-- The market's own copy of the figure goes, now that the fund holds it.
ALTER TABLE markets DROP COLUMN subsidy_budget_cents;
ALTER TABLE markets DROP COLUMN subsidy_rate_cents;

COMMIT;
