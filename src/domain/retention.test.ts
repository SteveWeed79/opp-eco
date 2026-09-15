import { describe, it, expect } from "vitest";
import type { Application, Student } from "./types";
import {
  PURGED_NAME,
  RETENTION_SCHEDULE,
  lastActivityFor,
  purgeBlockReason,
  purgeStudent,
  retentionRule,
  retentionStatusFor,
  stillParticipating,
} from "./retention";

const NOW = new Date("2026-06-01T00:00:00.000Z");

function student(overrides: Partial<Student> = {}): Student {
  return {
    id: "stu-1",
    marketId: "mkt-1",
    userId: "u-1",
    collegeId: "org-college",
    name: "Nina Alvarez",
    email: "ninaa@students.example.edu",
    programOfStudy: "Mechanical Engineering Technology",
    classStanding: "Junior",
    expectedGraduation: "May 2027",
    skills: ["CAD"],
    interests: ["Robotics"],
    availableHoursPerWeek: 20,
    status: "verified",
    eligibility: "eligible",
    eligibilityDeterminedOn: null,
    eligibilityExpiresOn: null,
    verifiedOn: "2021-01-01T00:00:00.000Z",
    purgedOn: null,
    ...overrides,
  };
}

function application(overrides: Partial<Application> = {}): Application {
  return {
    id: "app-1",
    marketId: "mkt-1",
    postingId: "post-1",
    studentId: "stu-1",
    track: "standard",
    status: "closed",
    furthestStatus: "credit_granted",
    submittedOn: "2021-01-01T00:00:00.000Z",
    statusSince: "2021-06-01T00:00:00.000Z",
    matchScore: { score: 80, algorithmVersion: "v1", factors: [] },
    version: 1,
    ...overrides,
  };
}

describe("the schedule", () => {
  it("gives every record type a figure and a rationale", () => {
    // A schedule expressed as "to be determined" is the same as no schedule.
    for (const rule of RETENTION_SCHEDULE) {
      expect(rule.days).toBeGreaterThan(0);
      expect(rule.anchor.trim().length).toBeGreaterThan(0);
      expect(rule.rationale.trim().length).toBeGreaterThan(0);
    }
  });

  it("keeps uploaded files the shortest time of anything", () => {
    // The least valuable thing to keep and the most annoying thing to leak.
    const shortest = [...RETENTION_SCHEDULE].sort((a, b) => a.days - b.days)[0];
    expect(shortest.record).toBe("uploaded_file");
  });

  it("keeps the audit log the longest, and says why that is uncomfortable", () => {
    const longest = [...RETENTION_SCHEDULE].sort((a, b) => b.days - a.days)[0];
    expect(longest.record).toBe("audit_event");
    expect(longest.rationale).toMatch(/personal data about staff/i);
  });

  it("outlives identity with the placement record", () => {
    // The placement survives the purge; the name does not. That asymmetry is
    // what lets historical figures stay reconstructible.
    expect(retentionRule("application").days).toBeGreaterThan(
      retentionRule("learner_identity").days,
    );
  });
});

describe("when the clock starts", () => {
  it("runs from the last participation, not the record's creation", () => {
    // A learner who finished last month and one who finished three years ago
    // are the same record age and completely different questions.
    const last = lastActivityFor(student(), [
      application({ statusSince: "2021-06-01T00:00:00.000Z" }),
      application({ id: "app-2", statusSince: "2024-09-01T00:00:00.000Z" }),
    ]);
    expect(last).toBe("2024-09-01T00:00:00.000Z");
  });

  it("falls back to the verification date for a learner who never applied", () => {
    expect(lastActivityFor(student(), [])).toBe("2021-01-01T00:00:00.000Z");
  });

  it("returns nothing datable rather than guessing", () => {
    // A record the platform cannot date is one to investigate by hand, not one
    // to offer an irreversible button against.
    expect(lastActivityFor(student({ verifiedOn: null }), [])).toBeNull();
    expect(retentionStatusFor(student({ verifiedOn: null }), [], NOW)).toBeNull();
  });
});

describe("whether a learner is due", () => {
  it("is due once three years have passed since last participation", () => {
    const status = retentionStatusFor(student(), [application()], NOW)!;
    expect(status.due).toBe(true);
    expect(status.daysRemaining).toBeLessThan(0);
  });

  it("is not due while the anniversary is still ahead", () => {
    const recent = application({ statusSince: "2026-01-01T00:00:00.000Z" });
    const status = retentionStatusFor(student(), [recent], NOW)!;
    expect(status.due).toBe(false);
    expect(status.daysRemaining).toBeGreaterThan(0);
  });

  it("refuses to purge a learner who is still taking part", () => {
    // The rule is "no longer required for the purpose collected", and a live
    // application is that purpose. A schedule that anonymised an active learner
    // to satisfy a date would break the programme.
    const live = application({ status: "placement_active", statusSince: "2021-06-01T00:00:00.000Z" });
    expect(stillParticipating([live])).toBe(true);
    expect(purgeBlockReason(student(), [live], NOW)).toMatch(/still taking part/i);
  });

  it("permits it once everything has ended and the clock has run", () => {
    expect(purgeBlockReason(student(), [application()], NOW)).toBeNull();
  });

  it("refuses to purge twice", () => {
    expect(
      purgeBlockReason(student({ purgedOn: "2026-01-01T00:00:00.000Z" }), [application()], NOW),
    ).toMatch(/already been purged/i);
  });

  it("names the date when it is not yet due", () => {
    const recent = application({ statusSince: "2026-01-01T00:00:00.000Z" });
    expect(purgeBlockReason(student(), [recent], NOW)).toMatch(/not due until/i);
  });
});

describe("what purging does", () => {
  const purged = purgeStudent(student(), NOW);

  it("removes every direct identifier", () => {
    expect(purged.name).toBe(PURGED_NAME);
    expect(purged.email).toBe("");
    expect(purged.skills).toEqual([]);
    expect(purged.interests).toEqual([]);
    expect(purged.expectedGraduation).toBe("");
  });

  it("keeps what aggregate reporting is by", () => {
    // Deleting the learner would silently restate every historical figure a
    // board was already reported. The programme data survives.
    expect(purged.programOfStudy).toBe("Mechanical Engineering Technology");
    expect(purged.collegeId).toBe("org-college");
    expect(purged.marketId).toBe("mkt-1");
    expect(purged.status).toBe("verified");
  });

  it("dates itself, so the record says it happened", () => {
    expect(purged.purgedOn).toBe(NOW.toISOString());
  });
});
