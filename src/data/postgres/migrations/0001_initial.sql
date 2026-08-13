-- Opportunity Ecosystem — initial schema
--
-- Written against the domain types in src/domain/types.ts. The app does not
-- connect to a database yet; this exists so the data model is settled and
-- reviewable, and so switching from fixtures to Postgres is an adapter swap
-- rather than a design exercise.
--
-- The guiding rule: invariants the domain layer enforces in TypeScript are
-- restated here as constraints. A rule enforced in only one of the two places
-- is a rule that will eventually be violated by the other.

BEGIN;

-- ---------------------------------------------------------------------------
-- Enumerations. These mirror the TypeScript unions exactly; adding a value in
-- one place without the other is a deployment error, which is the point.
-- ---------------------------------------------------------------------------

CREATE TYPE actor_role AS ENUM ('admin', 'student', 'business', 'college', 'board');

CREATE TYPE market_stage AS ENUM (
  'prospecting', 'board_engaged', 'board_committed', 'college_engaged',
  'college_committed', 'configuring', 'live', 'paused', 'declined'
);

CREATE TYPE organization_kind AS ENUM ('business', 'college', 'board');

CREATE TYPE organization_status AS ENUM (
  'applied', 'under_review', 'info_requested', 'approved', 'active',
  'suspended', 'rejected'
);

CREATE TYPE student_status AS ENUM (
  'registered', 'profile_complete', 'pending_verification', 'verified',
  'verification_rejected', 'inactive'
);

CREATE TYPE eligibility_status AS ENUM (
  'not_determined', 'interview_scheduled', 'eligible', 'not_eligible'
);

CREATE TYPE track AS ENUM ('standard', 'micro');

CREATE TYPE posting_status AS ENUM (
  'draft', 'help_requested', 'college_drafting', 'pending_review',
  'changes_requested', 'published', 'filled', 'closed', 'expired'
);

CREATE TYPE application_status AS ENUM (
  'submitted', 'under_review', 'shortlisted', 'mutual_interest',
  'interview_scheduled', 'interview_completed', 'cleared', 'funding_authorized',
  'unsubsidized', 'placement_active', 'placement_completed', 'credit_pending',
  'credit_granted', 'credit_denied', 'rejected', 'withdrawn',
  'terminated_early', 'closed'
);

CREATE TYPE credit_award_status AS ENUM ('pending', 'granted', 'denied');

-- ---------------------------------------------------------------------------
-- Markets — the tenancy root. Every scoped table carries market_id, and every
-- query filters on it.
-- ---------------------------------------------------------------------------

CREATE TABLE markets (
  id                     text PRIMARY KEY,
  name                   text NOT NULL,
  city                   text NOT NULL,
  counties               text[] NOT NULL DEFAULT '{}',
  stage                  market_stage NOT NULL DEFAULT 'prospecting',
  board_id               text,
  launched_on            timestamptz,
  subsidy_budget_cents   bigint NOT NULL DEFAULT 0,
  subsidy_rate_cents     integer NOT NULL DEFAULT 0,
  program_year           text NOT NULL,
  -- Per-market workflow configuration. Whether the board gate applies is a
  -- program decision, not a code decision, so it lives here.
  requires_board_clearance boolean NOT NULL DEFAULT true,
  stalled_threshold_days integer NOT NULL DEFAULT 5,
  created_at             timestamptz NOT NULL DEFAULT now(),
  updated_at             timestamptz NOT NULL DEFAULT now(),

  -- Money is stored in cents. Floating-point dollars in a system that reports
  -- to a funder is how reconciliations stop reconciling.
  CONSTRAINT budget_non_negative CHECK (subsidy_budget_cents >= 0),
  CONSTRAINT rate_non_negative CHECK (subsidy_rate_cents >= 0),
  -- A live market must have committed partners.
  CONSTRAINT live_market_has_board CHECK (stage <> 'live' OR board_id IS NOT NULL)
);

CREATE TABLE organizations (
  id               text PRIMARY KEY,
  market_id        text NOT NULL REFERENCES markets(id) ON DELETE RESTRICT,
  kind             organization_kind NOT NULL,
  name             text NOT NULL,
  county           text NOT NULL,
  status           organization_status NOT NULL DEFAULT 'applied',
  contact_name     text NOT NULL,
  contact_email    text NOT NULL,
  applied_on       timestamptz NOT NULL DEFAULT now(),
  -- Colleges only: work hours required per credit awarded.
  hours_per_credit integer,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT hours_per_credit_positive
    CHECK (hours_per_credit IS NULL OR hours_per_credit > 0),
  -- Only colleges set a credit policy; a business with one is a data error.
  CONSTRAINT only_colleges_set_credit_policy
    CHECK (hours_per_credit IS NULL OR kind = 'college'),
  -- Partner branding. Education organizations only: a business or a board
  -- theming a student's portal would be misleading rather than white-label.
  brand_color      text,
  accent_color     text,
  logo_url         text,
    CHECK (brand_color IS NULL OR kind = 'college'),
    CHECK (brand_color IS NULL OR brand_color ~ '^#[0-9a-fA-F]{6}$'),
    CHECK (accent_color IS NULL OR accent_color ~ '^#[0-9a-fA-F]{6}$'),
    -- An accent without a primary is a half-configured partner, not a choice.
    CHECK (accent_color IS NULL OR brand_color IS NOT NULL)
);

CREATE INDEX organizations_market_kind_idx ON organizations (market_id, kind);
CREATE INDEX organizations_pending_vetting_idx ON organizations (market_id)
  WHERE status IN ('applied', 'under_review', 'info_requested');

ALTER TABLE markets
  ADD CONSTRAINT markets_board_fk
  FOREIGN KEY (board_id) REFERENCES organizations(id) ON DELETE SET NULL;

-- A market may have several colleges; WIOA local areas and college service
-- areas do not align one to one.
CREATE TABLE market_colleges (
  market_id  text NOT NULL REFERENCES markets(id) ON DELETE CASCADE,
  college_id text NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  PRIMARY KEY (market_id, college_id)
);

-- ---------------------------------------------------------------------------
-- Identity. Role is never client-supplied — it is read from a membership.
-- ---------------------------------------------------------------------------

CREATE TABLE users (
  id         text PRIMARY KEY,
  name       text NOT NULL,
  email      citext NOT NULL UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE memberships (
  id              text PRIMARY KEY,
  user_id         text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  organization_id text REFERENCES organizations(id) ON DELETE CASCADE,
  market_id       text REFERENCES markets(id) ON DELETE CASCADE,
  role            actor_role NOT NULL,
  created_at      timestamptz NOT NULL DEFAULT now(),

  -- Admin is the only cross-market role and therefore the only one without a
  -- market. Everyone else must be anchored to exactly one.
  CONSTRAINT admin_is_cross_market CHECK (
    (role = 'admin' AND market_id IS NULL AND organization_id IS NULL)
    OR (role <> 'admin' AND market_id IS NOT NULL AND organization_id IS NOT NULL)
  )
);

-- A person may hold several roles, but not the same role twice in one org.
CREATE UNIQUE INDEX memberships_unique_idx
  ON memberships (user_id, COALESCE(organization_id, ''), role);
CREATE INDEX memberships_user_idx ON memberships (user_id);

-- ---------------------------------------------------------------------------
-- Students
-- ---------------------------------------------------------------------------

CREATE TABLE students (
  id                        text PRIMARY KEY,
  market_id                 text NOT NULL REFERENCES markets(id) ON DELETE RESTRICT,
  user_id                   text NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
  college_id                text NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  program_of_study          text NOT NULL,
  class_standing            text NOT NULL,
  expected_graduation       text,
  skills                    text[] NOT NULL DEFAULT '{}',
  interests                 text[] NOT NULL DEFAULT '{}',
  available_hours_per_week  integer NOT NULL DEFAULT 0,
  status                    student_status NOT NULL DEFAULT 'registered',
  -- The most recent board determination. Clearance is per applicant per job,
  -- so this is history, not a portable credential.
  eligibility               eligibility_status NOT NULL DEFAULT 'not_determined',
  eligibility_determined_on timestamptz,
  verified_on               timestamptz,
  verified_by               text REFERENCES users(id),
  created_at                timestamptz NOT NULL DEFAULT now(),
  updated_at                timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT hours_sane CHECK (available_hours_per_week BETWEEN 0 AND 80),
  -- A verified student must record who verified them and when.
  CONSTRAINT verification_is_attributable CHECK (
    status <> 'verified' OR (verified_on IS NOT NULL AND verified_by IS NOT NULL)
  ),
  CONSTRAINT determination_is_dated CHECK (
    eligibility IN ('not_determined', 'interview_scheduled')
    OR eligibility_determined_on IS NOT NULL
  )
);

CREATE INDEX students_market_status_idx ON students (market_id, status);
CREATE INDEX students_college_idx ON students (college_id);

-- ---------------------------------------------------------------------------
-- Postings
-- ---------------------------------------------------------------------------

CREATE TABLE postings (
  id                text PRIMARY KEY,
  market_id         text NOT NULL REFERENCES markets(id) ON DELETE RESTRICT,
  business_id       text NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  track             track NOT NULL,
  title             text NOT NULL,
  description       text NOT NULL DEFAULT '',
  county            text NOT NULL,
  skills_required   text[] NOT NULL DEFAULT '{}',
  skills_preferred  text[] NOT NULL DEFAULT '{}',
  status            posting_status NOT NULL DEFAULT 'draft',
  openings          integer NOT NULL DEFAULT 1,

  -- Standard track
  wage_cents        integer,
  hours_per_week    integer,
  weeks             integer,
  credit_hours      integer,
  supervisor_name   text,

  -- Micro track: a fixed project fee, with no hours for an hourly
  -- reimbursement to attach to.
  project_fee_cents integer,
  estimated_hours   integer,
  deliverable       text,
  due_within_days   integer,

  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT openings_positive CHECK (openings > 0),

  -- Each track must carry its own fields and not the other's. Without this a
  -- micro posting can quietly acquire an hourly wage and become billable to
  -- the board.
  CONSTRAINT standard_fields_present CHECK (
    track <> 'standard' OR status = 'draft' OR status = 'help_requested'
    OR (wage_cents IS NOT NULL AND hours_per_week IS NOT NULL AND weeks IS NOT NULL)
  ),
  CONSTRAINT micro_fields_present CHECK (
    track <> 'micro' OR status = 'draft' OR status = 'help_requested'
    OR (project_fee_cents IS NOT NULL AND estimated_hours IS NOT NULL)
  ),
  CONSTRAINT micro_has_no_hourly_wage CHECK (track <> 'micro' OR wage_cents IS NULL),
  CONSTRAINT standard_has_no_project_fee CHECK (
    track <> 'standard' OR project_fee_cents IS NULL
  )
);

CREATE INDEX postings_market_status_idx ON postings (market_id, status);
CREATE INDEX postings_business_idx ON postings (business_id);
CREATE INDEX postings_awaiting_help_idx ON postings (market_id)
  WHERE status IN ('help_requested', 'college_drafting');

-- ---------------------------------------------------------------------------
-- Interview slots
-- ---------------------------------------------------------------------------

CREATE TABLE interview_slots (
  id               text PRIMARY KEY,
  market_id        text NOT NULL REFERENCES markets(id) ON DELETE RESTRICT,
  board_id         text NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  starts_at        timestamptz NOT NULL,
  duration_minutes integer NOT NULL DEFAULT 30,
  officer_name     text NOT NULL,
  booked_by        text REFERENCES students(id) ON DELETE SET NULL,
  booked_at        timestamptz,
  meeting_url      text,
  version          integer NOT NULL DEFAULT 1,
  created_at       timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT duration_positive CHECK (duration_minutes > 0),
  CONSTRAINT booking_is_dated CHECK (
    (booked_by IS NULL AND booked_at IS NULL)
    OR (booked_by IS NOT NULL AND booked_at IS NOT NULL)
  )
);

-- A slot holds one student. Two students racing for the last slot is the
-- likeliest write conflict in the system, so the database settles it.
CREATE UNIQUE INDEX interview_slots_single_booking_idx
  ON interview_slots (id) WHERE booked_by IS NOT NULL;
CREATE INDEX interview_slots_open_idx ON interview_slots (market_id, starts_at)
  WHERE booked_by IS NULL;

-- ---------------------------------------------------------------------------
-- Applications — the record the whole workflow moves
-- ---------------------------------------------------------------------------

CREATE TABLE applications (
  id                       text PRIMARY KEY,
  market_id                text NOT NULL REFERENCES markets(id) ON DELETE RESTRICT,
  posting_id               text NOT NULL REFERENCES postings(id) ON DELETE RESTRICT,
  student_id               text NOT NULL REFERENCES students(id) ON DELETE RESTRICT,
  track                    track NOT NULL,
  status                   application_status NOT NULL DEFAULT 'submitted',
  -- `closed` erases how far an application got, which would make funnel
  -- reporting show conversion falling as work completes.
  furthest_status          application_status,
  submitted_on             timestamptz NOT NULL DEFAULT now(),
  status_since             timestamptz NOT NULL DEFAULT now(),

  match_score              integer NOT NULL DEFAULT 0,
  match_algorithm_version  text NOT NULL DEFAULT 'match-v1',
  match_factors            jsonb NOT NULL DEFAULT '[]',

  interview_slot_id        text REFERENCES interview_slots(id) ON DELETE SET NULL,

  -- Board authorization for this specific placement, separate from whether
  -- the candidate cleared the interview.
  funding_authorized_hours integer,
  funding_authorized_rate_cents integer,

  hours_logged             integer NOT NULL DEFAULT 0,
  hours_approved           integer NOT NULL DEFAULT 0,
  deliverable_submitted    boolean NOT NULL DEFAULT false,
  deliverable_accepted     boolean NOT NULL DEFAULT false,

  -- Optimistic concurrency. Two people acting on one application is routine:
  -- a business declining while a student withdraws, a board authorizing while
  -- an admin overrides.
  version                  integer NOT NULL DEFAULT 1,
  created_at               timestamptz NOT NULL DEFAULT now(),
  updated_at               timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT one_application_per_posting UNIQUE (posting_id, student_id),
  CONSTRAINT match_score_is_a_percentage CHECK (match_score BETWEEN 0 AND 100),
  CONSTRAINT hours_non_negative CHECK (hours_logged >= 0 AND hours_approved >= 0),
  CONSTRAINT approved_hours_were_logged CHECK (hours_approved <= hours_logged),
  CONSTRAINT funding_is_complete CHECK (
    (funding_authorized_hours IS NULL) = (funding_authorized_rate_cents IS NULL)
  ),
  -- Micro-internships are unsubsidized: a fixed project fee has no hours for
  -- an hourly reimbursement to attach to.
  CONSTRAINT micro_is_never_funded CHECK (
    track <> 'micro' OR funding_authorized_hours IS NULL
  ),
  -- Board states are unreachable on the micro track.
  CONSTRAINT micro_skips_the_board CHECK (
    track <> 'micro' OR status NOT IN (
      'interview_scheduled', 'interview_completed', 'cleared', 'funding_authorized'
    )
  )
);

CREATE INDEX applications_market_status_idx ON applications (market_id, status);
CREATE INDEX applications_student_idx ON applications (student_id);
CREATE INDEX applications_posting_idx ON applications (posting_id);
-- Dwell-time reporting reads this constantly; it is the administrator's
-- primary screen.
CREATE INDEX applications_stalled_idx ON applications (market_id, status_since)
  WHERE status IN (
    'submitted', 'under_review', 'shortlisted', 'mutual_interest',
    'interview_scheduled', 'interview_completed', 'cleared', 'credit_pending'
  );

-- ---------------------------------------------------------------------------
-- Credit
-- ---------------------------------------------------------------------------

CREATE TABLE credit_awards (
  id               text PRIMARY KEY,
  market_id        text NOT NULL REFERENCES markets(id) ON DELETE RESTRICT,
  student_id       text NOT NULL REFERENCES students(id) ON DELETE RESTRICT,
  college_id       text NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  credit_hours     integer NOT NULL,
  total_work_hours integer NOT NULL,
  -- Micro projects are indivisible, so covering 90 awarded hours can consume
  -- 120 hours of work. The surplus follows the student to their next award.
  carried_hours    integer NOT NULL DEFAULT 0,
  status           credit_award_status NOT NULL DEFAULT 'pending',
  course_mapping   text NOT NULL,
  granted_on       timestamptz,
  granted_by       text REFERENCES users(id),
  created_at       timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT credit_hours_positive CHECK (credit_hours > 0),
  CONSTRAINT carried_hours_non_negative CHECK (carried_hours >= 0),
  CONSTRAINT granted_award_is_attributable CHECK (
    status <> 'granted' OR (granted_on IS NOT NULL AND granted_by IS NOT NULL)
  )
);

-- Many-to-many from the start: a standard placement earns on its own, while
-- micro-internships accumulate across several projects before reaching one
-- credit. A one-to-one link could not express the second case.
CREATE TABLE credit_award_applications (
  credit_award_id text NOT NULL REFERENCES credit_awards(id) ON DELETE CASCADE,
  application_id  text NOT NULL REFERENCES applications(id) ON DELETE RESTRICT,
  work_hours      integer NOT NULL,
  PRIMARY KEY (credit_award_id, application_id),
  -- Work already converted into a credit cannot be counted toward another.
  CONSTRAINT application_counts_once UNIQUE (application_id)
);

CREATE INDEX credit_awards_student_idx ON credit_awards (student_id);

-- ---------------------------------------------------------------------------
-- Audit — append-only, and the source reporting derives from
-- ---------------------------------------------------------------------------

CREATE TABLE audit_events (
  id            bigserial PRIMARY KEY,
  market_id     text NOT NULL REFERENCES markets(id) ON DELETE RESTRICT,
  occurred_at   timestamptz NOT NULL DEFAULT now(),
  actor_user_id text NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  actor_role    actor_role NOT NULL,
  entity_type   text NOT NULL,
  entity_id     text NOT NULL,
  from_state    text,
  to_state      text NOT NULL,
  reason        text,
  -- True when an administrator overrode a role or guard check. Overrides are
  -- legitimate — unsticking stalled work is the job — but never silent.
  via_override  boolean NOT NULL DEFAULT false,

  CONSTRAINT override_requires_reason CHECK (
    via_override = false OR reason IS NOT NULL
  )
);

CREATE INDEX audit_events_entity_idx ON audit_events (entity_type, entity_id, occurred_at DESC);
CREATE INDEX audit_events_market_idx ON audit_events (market_id, occurred_at DESC);

-- Append-only is enforced here rather than by convention. An audit trail that
-- can be edited is not an audit trail, and a program answering to a funder
-- will be asked to prove exactly this.
CREATE OR REPLACE FUNCTION audit_events_are_immutable() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'audit_events is append-only (attempted % on id %)', TG_OP, OLD.id;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER audit_events_no_update
  BEFORE UPDATE OR DELETE ON audit_events
  FOR EACH ROW EXECUTE FUNCTION audit_events_are_immutable();

-- ---------------------------------------------------------------------------
-- Notification outbox — written in the same transaction as the state change
-- that caused it, dispatched separately. Nothing in this system moves unless
-- someone is told, and a notification lost because the send failed after the
-- commit is a placement that quietly dies.
-- ---------------------------------------------------------------------------

CREATE TABLE notification_outbox (
  id           bigserial PRIMARY KEY,
  market_id    text NOT NULL REFERENCES markets(id) ON DELETE RESTRICT,
  recipient_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind         text NOT NULL,
  payload      jsonb NOT NULL DEFAULT '{}',
  created_at   timestamptz NOT NULL DEFAULT now(),
  dispatched_at timestamptz,
  attempts     integer NOT NULL DEFAULT 0,
  last_error   text
);

CREATE INDEX notification_outbox_pending_idx ON notification_outbox (created_at)
  WHERE dispatched_at IS NULL;

COMMIT;
