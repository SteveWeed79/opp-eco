-- Retention: mark when a learner's identity was removed.
--
-- The Kansas Student Data Privacy Act requires deleting a student's personal
-- information once it is no longer required for the purpose collected, and with
-- dual-credit high schoolers in scope that binds directly. A schedule decided
-- before there is real data is the only version of that requirement anybody can
-- actually meet — a record with no deletion date is a record kept forever.
--
-- The column is a marker, not a mechanism. What a purge does lives in
-- `domain/retention.ts`, and it **anonymises rather than deletes**: the rows
-- stay and the identifiers go. A programme has accountability obligations that
-- outlive any individual's privacy interest, and deleting a learner would
-- silently restate every historical figure a board was already reported.
--
-- Note where the identifiers actually are. `students` holds no name and no
-- email — those are on `users`, joined in on read — so a purge writes to both
-- tables, and the invariant "a purged learner has no contact details" cannot be
-- a CHECK on either one alone. It is enforced by `purgeLearner`, which is the
-- only write path that can set this column.

BEGIN;

ALTER TABLE students ADD COLUMN purged_on timestamptz;

-- The admin console lists what is due, oldest first, and skips what is done.
CREATE INDEX students_unpurged_idx ON students (market_id)
  WHERE purged_on IS NULL;

COMMIT;
