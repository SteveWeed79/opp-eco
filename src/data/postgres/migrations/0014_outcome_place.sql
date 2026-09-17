-- Where they went, instead of somebody's opinion about whether it counted.
--
-- `outcome_kind` carried `employed_by_host`, `employed_in_region` and
-- `employed_elsewhere` — three values answering three different questions at
-- once: what happened, who employs them, and where. Welding the place into the
-- outcome type made "in region" a judgement the recorder made, with no
-- definition of region anywhere. Pittsburg is twenty miles from Joplin across a
-- state line, and two colleges will draw that line differently. A comparison
-- broken that way still renders as a clean chart, which is what makes it worth
-- a migration rather than a note.
--
-- So the place is captured and the answer is derived, against the counties a
-- market declares. One captured county also answers county, workforce-area and
-- state roll-ups; a boolean answers none of them and cannot be re-derived when
-- the boundary you meant turns out to be wrong.

BEGIN;

-- ---------------------------------------------------------------------------
-- The market declares the region its outcomes are measured against
-- ---------------------------------------------------------------------------

-- `counties` has always been here. What was missing is which state they are in,
-- and it is load-bearing rather than decoration: Kansas and Missouri each have
-- a Jackson County, so a county name alone cannot answer whether somebody
-- stayed. Defaulted for the existing rows and then pinned NOT NULL, because
-- every market this schema has ever held is in Kansas and a nullable state
-- would be a third answer to a two-answer question.
ALTER TABLE markets ADD COLUMN state text NOT NULL DEFAULT 'KS';
ALTER TABLE markets ALTER COLUMN state DROP DEFAULT;

ALTER TABLE markets ADD CONSTRAINT market_state_is_a_code
  CHECK (state ~ '^[A-Z]{2}$');

-- ---------------------------------------------------------------------------
-- The kind stops being a place
-- ---------------------------------------------------------------------------

-- `text` with a CHECK rather than a new enum, following `audit_events.entity_type`
-- for the reason 0003 gives there: an enum buys nothing a constraint does not,
-- and costs a two-transaction dance every time a value moves, because Postgres
-- refuses to use an enum label in the transaction that added it. Doing it as
-- text makes this one migration instead of two.
ALTER TABLE outcomes ALTER COLUMN kind TYPE text USING kind::text;

ALTER TABLE outcomes ADD COLUMN employed_by_host boolean NOT NULL DEFAULT false;
ALTER TABLE outcomes ADD COLUMN employment_county text;
ALTER TABLE outcomes ADD COLUMN employment_state text;

-- The judgement the old rows carried, kept as exactly what it was.
--
-- Those rows are real history and their place is genuinely unknown — nobody
-- recorded a county, and nobody can be phoned two years later to ask. Writing a
-- guessed county here would be inventing evidence; dropping the flag would
-- throw away what the recorder actually claimed. So the claim is preserved and
-- labelled as a claim, and `inRegion` prefers a captured place and falls back
-- to this only when there is none.
ALTER TABLE outcomes ADD COLUMN asserted_in_region boolean;

UPDATE outcomes SET employed_by_host = true, asserted_in_region = true
  WHERE kind = 'employed_by_host';
UPDATE outcomes SET asserted_in_region = true
  WHERE kind = 'employed_in_region';
UPDATE outcomes SET asserted_in_region = false
  WHERE kind = 'employed_elsewhere';

UPDATE outcomes SET kind = 'employed'
  WHERE kind IN ('employed_by_host', 'employed_in_region', 'employed_elsewhere');

ALTER TABLE outcomes ADD CONSTRAINT outcome_kind_known CHECK (
  kind IN ('employed', 'continued_education', 'entered_training', 'still_seeking')
);

-- A place is both halves or neither. A county with no state is the ambiguity
-- this migration exists to remove, arriving by a different door.
ALTER TABLE outcomes ADD CONSTRAINT employment_place_is_complete CHECK (
  (employment_county IS NULL) = (employment_state IS NULL)
);

ALTER TABLE outcomes ADD CONSTRAINT employment_state_is_a_code CHECK (
  employment_state IS NULL OR employment_state ~ '^[A-Z]{2}$'
);

-- Only an employment outcome has somewhere it happened. Without this a county
-- could sit on "still looking" and be counted by a query that only checked the
-- column was populated.
ALTER TABLE outcomes ADD CONSTRAINT place_belongs_to_employment CHECK (
  kind = 'employed'
  OR (employment_county IS NULL AND employed_by_host = false
      AND asserted_in_region IS NULL)
);

-- Nothing references it now.
DROP TYPE outcome_kind;

COMMIT;
