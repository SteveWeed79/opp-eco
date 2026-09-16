-- A third way an organization's people prove who they are.
--
-- Its own migration for the reason 0005 gives: a value added to an enum cannot
-- be used in the transaction that added it, so the table and the backfill that
-- refer to 'password' have to wait for 0013.
--
-- What this admits is that the previous design over-applied a rule. The data
-- rules say to federate a *government* identity rather than replicate it, and
-- that was generalised into "nobody gets a password" — which is a standard
-- written for public employees imposed on a sophomore at a community college.
-- A learner, an employer and a college are not the population that rule is
-- about.

BEGIN;

ALTER TYPE identity_mode ADD VALUE IF NOT EXISTS 'password';

COMMIT;
