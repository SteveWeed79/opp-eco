-- The demonstration becomes data, and says so about itself.
--
-- The prototype and the product are the same application. Which one you are
-- looking at has been decided by `AUTH_MODE` — a property of the *process* —
-- and that was always the wrong thing to hang it on, for a reason that shows
-- up the moment a deployment runs real sign-on over seeded fixtures: the
-- banner reading "every organization, student, and figure shown is fictional"
-- is a claim about **rows**, and a process cannot know whether it is true.
--
-- So the claim moves onto the rows. One column, on `markets`, and everything
-- else derives from it: every other table in this schema carries `market_id`,
-- so "is this row part of the demonstration" is already answerable for all of
-- them without a second column anywhere.
--
-- Two decisions in the shape of it are load-bearing.
--
-- **The fake is flagged, not the real**, and the default is `false`. A market
-- is real because nobody did anything to it. The failure mode of forgetting is
-- therefore that the demonstration looks empty — not that a real learner's
-- record is served to an anonymous visitor. The other polarity fails the other
-- way, silently, and this product holds minors' education records.
--
-- **Nothing in the application can write it.** Not because a rule says so —
-- because `markets` has no write path at all: no INSERT, no UPDATE, anywhere
-- outside the operator scripts and the tests. Every market in existence came
-- from `db:seed`. A flag on a table the product cannot touch cannot drift, and
-- it cannot be flipped by a bug or by a compromised administrator. It can only
-- change if somebody adds a market write, which is a visible act in a diff
-- rather than an omission — and `markets.test.ts` fails when they do.
--
-- This migration deliberately flags nothing. It adds the column with a safe
-- default and stops. `db:seed` flags the markets it creates, because the seed
-- is what makes them fictional; an existing deployment stays entirely real
-- until somebody seeds it, which is the correct answer for a database that
-- already holds somebody's work.

BEGIN;

ALTER TABLE markets
  ADD COLUMN is_demo_data boolean NOT NULL DEFAULT false;

-- Partial, because the interesting question is only ever "which markets are
-- the demonstration" — a handful of rows against however many real markets
-- eventually exist. The predicate lands in the anonymous visitor's market
-- lookup and in the administrator's cross-market totals, both of which run on
-- every request to their surface.
CREATE INDEX markets_demo_data_idx ON markets (id) WHERE is_demo_data;

COMMENT ON COLUMN markets.is_demo_data IS
  'True for the demonstration. Set by db:seed, never by the application — '
  'markets have no write path in the product. Real markets are real by '
  'default, so forgetting this flag hides the demo rather than exposing a '
  'learner.';

COMMIT;
