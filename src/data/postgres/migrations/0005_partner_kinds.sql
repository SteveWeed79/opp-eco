-- One more kind of organization: a foundation.
--
-- The vision names a wider network than this model holds — K-12 districts,
-- training providers, economic development offices, chambers. This adds exactly
-- one of them, because exactly one has something concrete to do: sponsor a
-- funding source. The others would be a longer enum and no behaviour.
--
-- Its own migration rather than part of 0006, and that is a Postgres detail
-- worth stating: a value added to an enum cannot be used in the transaction
-- that added it. Separating the two means the funding tables and the seed can
-- both refer to 'nonprofit' without depending on when it was committed.
--
-- Note what this does NOT change: `canTransact` still gates posting and
-- mentorship on a vetting check written for employers. A foundation is not
-- vetted for the reasons an employer is, and nothing here asks it to be —
-- sponsoring a fund is not transacting with a student.

BEGIN;

ALTER TYPE organization_kind ADD VALUE IF NOT EXISTS 'nonprofit';

COMMIT;
