-- Consent, attached to the institution whose records it covers.
--
-- Once a college hands this platform a roster, a verification or a credit
-- award, those are education records under FERPA, and everything that is not
-- designated directory information needs written consent to disclose.
--
-- `source_org_id` is the whole design. Consent is a property of the record's
-- source institution, not of the learner and not of this platform: a college's
-- consent does not authorise a high school's records about the same person, and
-- a dual-credit placement can generate both. A second institution in a
-- learner's story means a second row rather than a wider reading of the first.
--
-- `granted_by` is recorded rather than derived. FERPA rights transfer to the
-- learner at 18 *or* on postsecondary enrolment at any age, so a dual-enrolled
-- sixteen-year-old consents for themselves on the college's records while their
-- parent still holds the school's. Working that out needs the school a learner
-- attends, which this schema does not model, and a registrar's settled local
-- answer, which no column can supply.

BEGIN;

CREATE TYPE consent_scope AS ENUM (
  'education_record', 'workforce_data', 'program_participation'
);

CREATE TYPE consent_grantor AS ENUM ('learner', 'parent_guardian');
CREATE TYPE consent_status AS ENUM ('granted', 'withdrawn', 'expired');

CREATE TABLE consents (
  id                text PRIMARY KEY,
  market_id         text NOT NULL REFERENCES markets(id) ON DELETE RESTRICT,
  student_id        text NOT NULL REFERENCES students(id) ON DELETE RESTRICT,
  -- The institution whose records this covers.
  source_org_id     text NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  scope             consent_scope NOT NULL,
  granted_by        consent_grantor NOT NULL,
  granted_on        timestamptz NOT NULL DEFAULT now(),
  -- Null for open-ended, which is what most institutional forms are. The column
  -- exists because a district issuing per-academic-year consent has no other
  -- way to say so.
  expires_on        timestamptz,
  status            consent_status NOT NULL DEFAULT 'granted',
  recorded_by       text NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  note              text,
  version           integer NOT NULL DEFAULT 1,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),

  -- A consent recorded as already lapsed authorises nothing, so it is a
  -- data-entry slip rather than a decision anyone made.
  CONSTRAINT expiry_after_grant CHECK (expires_on IS NULL OR expires_on > granted_on),
  CONSTRAINT note_is_not_blank CHECK (note IS NULL OR length(btrim(note)) > 0)
);

-- The disclosure check runs on every employer read of a learner, so it must be
-- the cheapest lookup in the schema.
CREATE INDEX consents_in_force_idx
  ON consents (student_id, source_org_id, scope)
  WHERE status = 'granted';

CREATE INDEX consents_market_idx ON consents (market_id, granted_on DESC);

-- One consent of a given scope per learner per institution at a time. A second
-- while the first still stands is a duplicate form rather than a second
-- agreement; once withdrawn or lapsed, the same pair may consent again, which
-- is why this is partial rather than a plain unique constraint.
CREATE UNIQUE INDEX consents_one_in_force_per_scope
  ON consents (student_id, source_org_id, scope)
  WHERE status = 'granted';

COMMIT;
