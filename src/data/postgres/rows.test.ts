/**
 * The row boundary, where the database's types and the domain's disagree.
 *
 * Every case here is one the driver actually produces: `numeric` and `bigint`
 * as strings, `timestamptz` as a `Date`, cents as integers, `text[]` as a real
 * array. A mapper that looks right against hand-written object literals and
 * wrong against those is the failure this file exists to catch.
 */

import { describe, it, expect } from "vitest";
import {
  CLEARANCE_WINDOW_DAYS,
  cents,
  dateOnly,
  dollars,
  number,
  timestamp,
  toApplication,
  toAuditEvent,
  toCreditAward,
  toMarket,
  toPosting,
  toStudent,
  toTimeEntry,
} from "./rows";

describe("money", () => {
  it("reads cents as whole dollars", () => {
    expect(dollars(24_000_000)).toBe(240_000);
    expect(dollars(2_000)).toBe(20);
  });

  it("reads a bigint arriving as a string", () => {
    // `subsidy_budget_cents` is a bigint, and node-postgres will not parse
    // those into numbers on its own.
    expect(dollars("24000000")).toBe(240_000);
  });

  it("round-trips through cents", () => {
    for (const amount of [0, 20, 22, 4200, 240_000]) {
      expect(dollars(cents(amount))).toBe(amount);
    }
  });
});

describe("numbers the driver hands back as strings", () => {
  it("parses numeric", () => {
    // `hours_approved` is numeric(6,1) because timesheets have half hours.
    expect(number("44.5")).toBe(44.5);
    expect(number("0")).toBe(0);
  });

  it("treats null as zero rather than NaN", () => {
    expect(number(null)).toBe(0);
    expect(number(undefined)).toBe(0);
  });

  it("refuses something that is not a number at all", () => {
    // Better to fail at the boundary than to let NaN reach a funding guard.
    expect(() => number("not a number")).toThrow(TypeError);
  });
});

describe("dates", () => {
  it("renders a timestamptz Date as an ISO string", () => {
    const at = new Date("2026-08-18T14:30:00.000Z");
    expect(timestamp(at)).toBe("2026-08-18T14:30:00.000Z");
  });

  it("keeps a date column on its own day regardless of timezone", () => {
    // The driver parses `date` into a Date at *local* midnight. Slicing the
    // ISO string would move a Monday to the previous Sunday west of UTC.
    const monday = new Date(2026, 7, 10); // 10 Aug 2026, local
    expect(dateOnly(monday)).toBe("2026-08-10");
  });

  it("passes a date string through untouched", () => {
    expect(dateOnly("2026-08-10")).toBe("2026-08-10");
  });
});

describe("entities", () => {
  it("maps a market, including its colleges and its budget", () => {
    const market = toMarket({
      id: "mkt-1",
      name: "Southeast Kansas",
      city: "Pittsburg",
      counties: ["Crawford", "Labette"],
      stage: "live",
      board_id: "org-board",
      college_ids: ["org-college"],
      launched_on: new Date("2026-01-15T00:00:00.000Z"),
      subsidy_budget_cents: "24000000",
      subsidy_rate_cents: 2000,
      program_year: "PY2026",
    });

    expect(market.subsidyBudget).toBe(240_000);
    expect(market.subsidyRatePerHour).toBe(20);
    expect(market.collegeIds).toEqual(["org-college"]);
    expect(market.counties).toEqual(["Crawford", "Labette"]);
  });

  it("gives a market with no board a null rather than an empty string", () => {
    const market = toMarket({ id: "m", board_id: null, launched_on: null });
    expect(market.boardId).toBeNull();
    expect(market.launchedOn).toBeNull();
  });

  it("takes a student's name and email from the joined user", () => {
    // `students` has neither column — identity belongs to the person.
    const student = toStudent({
      id: "stu-1",
      market_id: "mkt-1",
      user_id: "usr-1",
      college_id: "org-college",
      name: "Omar Haddad",
      email: "omar@example.edu",
      program_of_study: "Computer Science",
      class_standing: "Sophomore",
      skills: ["Python"],
      interests: [],
      available_hours_per_week: 15,
      status: "verified",
      eligibility: "not_determined",
      eligibility_determined_on: null,
      verified_on: new Date("2026-06-01T00:00:00.000Z"),
    });

    expect(student.name).toBe("Omar Haddad");
    expect(student.email).toBe("omar@example.edu");
    expect(student.verifiedOn).toBe("2026-06-01T00:00:00.000Z");
  });

  it("derives clearance expiry from the determination date", () => {
    const determined = new Date("2026-01-01T00:00:00.000Z");
    const student = toStudent({
      eligibility_determined_on: determined,
      skills: [],
      interests: [],
    });

    const expected = new Date(
      determined.getTime() + CLEARANCE_WINDOW_DAYS * 86_400_000,
    ).toISOString();
    expect(student.eligibilityExpiresOn).toBe(expected);
  });

  it("leaves clearance expiry null when nothing was determined", () => {
    const student = toStudent({
      eligibility_determined_on: null,
      skills: [],
      interests: [],
    });
    expect(student.eligibilityExpiresOn).toBeNull();
  });

  it("maps a standard posting's wage and leaves the micro fields absent", () => {
    const posting = toPosting({
      id: "post-1",
      track: "standard",
      wage_cents: 2200,
      hours_per_week: 15,
      weeks: 14,
      credit_hours: 3,
      project_fee_cents: null,
      estimated_hours: null,
      skills_required: ["Python"],
      skills_preferred: [],
      openings: 1,
      created_at: new Date("2026-05-01T00:00:00.000Z"),
    });

    expect(posting.wagePerHour).toBe(22);
    // Absent, not zero — `postingTotalHours` and the credit rules both branch
    // on which fields a track actually carries.
    expect(posting.projectFee).toBeUndefined();
    expect(posting.estimatedHours).toBeUndefined();
  });

  it("maps a micro posting's fixed fee", () => {
    const posting = toPosting({
      track: "micro",
      wage_cents: null,
      project_fee_cents: 75_000,
      estimated_hours: 30,
      skills_required: [],
      skills_preferred: [],
      openings: 1,
    });
    expect(posting.projectFee).toBe(750);
    expect(posting.wagePerHour).toBeUndefined();
  });

  it("maps an application's cached hours and match score", () => {
    const application = toApplication({
      id: "app-1",
      market_id: "mkt-1",
      posting_id: "post-1",
      student_id: "stu-1",
      track: "standard",
      status: "placement_active",
      furthest_status: null,
      submitted_on: new Date("2026-06-12T00:00:00.000Z"),
      status_since: new Date("2026-07-01T00:00:00.000Z"),
      match_score: 65,
      match_algorithm_version: "match-v1",
      match_factors: [{ label: "Skills", weight: 0.5, contribution: 0.3 }],
      hours_logged: "64.5",
      hours_approved: "44.0",
      deliverable_submitted: false,
      deliverable_accepted: false,
      funding_authorized_hours: 210,
      funding_authorized_rate_cents: 2000,
      version: 3,
    });

    // Numbers, not strings — every transition guard compares these.
    expect(application.hoursLogged).toBe(64.5);
    expect(application.hoursApproved).toBe(44);
    expect(application.fundingAuthorizedRate).toBe(20);
    expect(application.matchScore.score).toBe(65);
    expect(application.matchScore.factors).toHaveLength(1);
    expect(application.furthestStatus).toBeUndefined();
    expect(application.version).toBe(3);
  });

  it("maps a time entry's half hours and its week", () => {
    const entry = toTimeEntry({
      id: "te-1",
      week_starting: "2026-08-10",
      hours: "7.5",
      summary: "Wrote the validation tests",
      status: "approved",
      submitted_on: new Date("2026-08-17T00:00:00.000Z"),
      reviewed_on: null,
      review_note: null,
      version: 1,
    });

    expect(entry.hours).toBe(7.5);
    expect(entry.weekStarting).toBe("2026-08-10");
    expect(entry.reviewedOn).toBeUndefined();
  });

  it("maps a credit award's applications from the join table", () => {
    const award = toCreditAward({
      id: "credit-1",
      application_ids: ["app-1", "app-2"],
      credit_hours: 1,
      total_work_hours: 90,
      carried_hours: 12,
      status: "granted",
      course_mapping: "INTR-289",
      granted_on: new Date("2026-07-20T00:00:00.000Z"),
    });

    expect(award.applicationIds).toEqual(["app-1", "app-2"]);
    expect(award.carriedHours).toBe(12);
  });

  it("keeps the audit log's bigserial id as a string", () => {
    // Nothing does arithmetic on it, and a bigint losing precision silently
    // past 2^53 is a worse default than a string that never can.
    const event = toAuditEvent({
      id: 10_231,
      market_id: "mkt-1",
      occurred_at: new Date("2026-08-18T09:00:00.000Z"),
      actor_user_id: "usr-1",
      actor_role: "board",
      entity_type: "application",
      entity_id: "app-1",
      from_state: "cleared",
      to_state: "funding_authorized",
      reason: null,
      via_override: false,
    });

    expect(event.id).toBe("10231");
    expect(event.at).toBe("2026-08-18T09:00:00.000Z");
    expect(event.from).toBe("cleared");
    expect(event.reason).toBeUndefined();
    expect(event.viaOverride).toBe(false);
  });
});
