-- The demonstration's audit history stops being permanent.
--
-- `audit_events` is append-only, enforced by a trigger that raises on UPDATE or
-- DELETE. That is right, and `SECURITY.md` names audit tampering among the
-- findings this project would treat as most serious. It had one consequence
-- nobody intended: `db:seed` used to TRUNCATE, which does not fire row
-- triggers, so the seed had been going *around* the guard rather than
-- respecting it. Scoping the seed to the demonstration's own markets is what
-- turned that into a visible error rather than a silent bypass.
--
-- With the bypass gone, a demonstration's audit trail could never be rebuilt.
-- Audit rows reference `markets` and `users` with ON DELETE RESTRICT, so once
-- the application had written one, neither the market nor the account could be
-- deleted either — the fixtures had to upsert them in place and leave a history
-- that would drift further from the fixtures with every change to them.
--
-- So the trigger gains one exemption, and where it is keyed is the whole of its
-- safety:
--
--  * **Only DELETE, never UPDATE.** Rebuilding a fictional history wholesale is
--    a different act from editing a record, and editing one is what tampering
--    looks like. An UPDATE is still refused on every row in the table.
--
--  * **Only rows in a market flagged `is_demo_data`.** That column defaults to
--    false, so the exemption never reaches a row nobody explicitly marked as
--    fictional. A real programme's audit trail is exactly as immutable as it
--    was.
--
--  * **The application cannot reach the exemption.** There is no INSERT or
--    UPDATE against `markets` anywhere outside the operator scripts, and
--    `markets.test.ts` fails the build if one appears. Application-level
--    tampering — which is what this trigger exists to stop — is still refused
--    outright.
--
--  * **It gives an attacker nothing.** Reaching it requires setting
--    `is_demo_data` on a real market, which requires direct database access,
--    and anyone holding that could drop the trigger. The bar is unchanged.
--
-- What this does not do is let anything delete an audit row through the
-- product. The only caller is `db:seed`.

BEGIN;

CREATE OR REPLACE FUNCTION audit_events_are_immutable() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' AND EXISTS (
    SELECT 1 FROM markets WHERE id = OLD.market_id AND is_demo_data
  ) THEN
    RETURN OLD;
  END IF;

  RAISE EXCEPTION 'audit_events is append-only (attempted % on id %)', TG_OP, OLD.id;
END;
$$ LANGUAGE plpgsql;

COMMIT;
