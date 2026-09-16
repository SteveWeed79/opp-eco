-- When the placement actually ended, as opposed to when the row last moved.
--
-- `applications.status_since` is overwritten on every transition. A placement
-- that finishes in May, has credit granted in June and is closed in August
-- carries a `status_since` of August, and anything measuring from "the exit"
-- was measuring from the last piece of paperwork instead.
--
-- That was tolerable while the only consumer was a queue sorted by age — being
-- three months out moves a row up or down a list. It stops being tolerable the
-- moment a follow-up is measured in fixed windows after exit, because three
-- months is enough to push an observation into the wrong quarter, and a cohort
-- measured against the wrong window is not comparable to one measured against
-- the right one. That is the same failure as recording "in region" as a
-- judgement: a comparison broken in a way that still renders as a clean chart.
--
-- The domain has said so for a while, in `daysSinceExit`:
--
--   `statusSince` stands in for the exit date. It is exact for a placement that
--   went straight to its terminal status and approximate for one that moved
--   again afterwards; a production build would read the audit log for the
--   moment the placement itself closed.
--
-- This is that production build. The audit log has recorded the real transition
-- all along, so nothing has to be invented — which is the difference between
-- this backfill and one that would have had to guess.

BEGIN;

ALTER TABLE applications ADD COLUMN exited_on timestamptz;

-- The first transition into a status that means the work is over.
--
-- `MIN`, not `MAX`: an application can enter several of these in sequence —
-- completed, then credit pending, then granted, then closed — and the exit is
-- the first of them. Taking the latest would reintroduce the bug this column
-- exists to fix, one aggregate function along.
--
-- Rows with no such entry in the log are left NULL and are correct as NULL:
-- they never exited. `exitDateOf` falls back to `status_since` for anything
-- that somehow has neither, which is the old approximation kept as a floor
-- rather than a behaviour anybody should rely on.
UPDATE applications a
SET exited_on = e.first_exit
FROM (
  SELECT entity_id, MIN(occurred_at) AS first_exit
  FROM audit_events
  WHERE entity_type = 'application'
    AND to_state IN (
      'placement_completed', 'terminated_early',
      'credit_pending', 'credit_granted', 'credit_denied', 'closed'
    )
  GROUP BY entity_id
) e
WHERE e.entity_id = a.id;

-- Deliberately no NOT NULL and no CHECK tying this to `status`.
--
-- A live placement has no exit date and must not be given one, so the column is
-- nullable by nature rather than by omission. And a constraint saying "exited
-- statuses have an exit date" would be false for every seeded fixture and every
-- row whose history predates the audit log — a constraint that can only be
-- satisfied by inventing data is a constraint that gets data invented for it.
CREATE INDEX applications_exited_on ON applications (exited_on)
  WHERE exited_on IS NOT NULL;

COMMIT;
