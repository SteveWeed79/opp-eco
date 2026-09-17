-- A region is a boundary with a date, not a column that can be edited.
--
-- `markets.counties` and `markets.state` were the definition of "in region"
-- that every retention figure is measured against. As columns they are always
-- whatever they are now, which is fine until a boundary moves — local workforce
-- areas are redesignated and MSAs are redrawn after each census — and then a
-- single mutable list does something quietly catastrophic: it rewrites every
-- figure ever computed. The 2026 retention rate recomputed in 2029 comes back
-- different, measured against a boundary nobody had in 2026, and nothing on the
-- screen says so.
--
-- The comment on those columns said this was coming: "these become state-level
-- reference data with effective dates once regions are redesignated".
--
-- This is the one genuinely irreversible piece of the report's snapshot design.
-- The totals stay recomputable — the retention purge anonymises rather than
-- deletes, so an outcome keeps its kind and its county — but a boundary nobody
-- wrote down cannot be reconstructed from anything.
--
-- Following what `funding_sources` did to `markets.subsidy_budget`: the value
-- moves to its own table and the column goes, because two places holding the
-- same fact is how they come to disagree.

BEGIN;

CREATE TABLE region_definitions (
  id text PRIMARY KEY,
  market_id text NOT NULL REFERENCES markets(id),

  -- Load-bearing rather than decoration. Kansas and Missouri both have a
  -- Jackson County, and Pittsburg is twenty miles from Joplin across the state
  -- line, so a county name alone cannot answer whether somebody stayed.
  state text NOT NULL,
  counties text[] NOT NULL,

  -- Inclusive. The definition in force at a moment is the latest one at or
  -- before it.
  --
  -- One date rather than a from/to pair, on purpose. A closed interval has to
  -- be kept consistent with its neighbour, and two rows disagreeing about where
  -- one boundary ends and the next begins is a gap no query would report.
  effective_from timestamptz NOT NULL,

  -- The redesignation notice, the census, the board's own paperwork.
  source text,

  -- Null on the rows this migration creates, and that is the honest value:
  -- they came out of a column, and a column has no author. Every definition
  -- written afterwards names one.
  recorded_by text REFERENCES users(id),
  recorded_on timestamptz NOT NULL,

  CONSTRAINT region_state_is_a_code CHECK (state ~ '^[A-Z]{2}$'),

  -- A market cannot have two boundaries starting at the same instant: which one
  -- is in force would be a coin toss, and the two data layers would each pick a
  -- different winner while both looked correct.
  CONSTRAINT region_one_definition_per_instant UNIQUE (market_id, effective_from)
);

CREATE INDEX region_definitions_in_force
  ON region_definitions (market_id, effective_from DESC);

-- ---------------------------------------------------------------------------
-- Move what the columns held
-- ---------------------------------------------------------------------------

-- Dated from far earlier than anything this system holds, and that is the
-- honest choice rather than a lazy one.
--
-- Nobody recorded when these county sets took effect. Claiming they began on
-- the market's launch date would invent a fact and would leave any observation
-- made before that launch with no boundary to be judged against. Claiming they
-- have always been in force asserts nothing about the world and is true of
-- every record here.
--
-- What matters is not this date. It is that every change after it is dated.
INSERT INTO region_definitions
  (id, market_id, state, counties, effective_from, recorded_by, recorded_on)
SELECT
  'region-' || replace(m.id, 'mkt-', ''),
  m.id,
  m.state,
  m.counties,
  timestamptz '2000-01-01 00:00:00+00',
  NULL,
  timestamptz '2000-01-01 00:00:00+00'
FROM markets m;

ALTER TABLE markets DROP CONSTRAINT market_state_is_a_code;
ALTER TABLE markets DROP COLUMN counties;
ALTER TABLE markets DROP COLUMN state;

COMMIT;
