import { describe, it, expect } from "vitest";
import {
  attemptTransition,
  availableTransitions,
  transitionsFrom,
  fundingCommitment,
  PAUSE_STATUSES,
  daysInStatus,
} from "./workflow";
import type {
  ActorContext,
  Application,
  ApplicationStatus,
  ActorRole,
  Student,
  Track,
} from "./types";

// --- fixtures --------------------------------------------------------------

function actor(role: ActorRole, marketId = "mkt-1"): ActorContext {
  return {
    user: { id: `u-${role}`, name: role, email: `${role}@example.org` },
    membership: {
      id: `m-${role}`,
      userId: `u-${role}`,
      organizationId: role === "admin" ? null : `org-${role}`,
      marketId: role === "admin" ? null : marketId,
      role,
    },
  };
}

function application(over: Partial<Application> = {}): Application {
  return {
    id: "app-1",
    marketId: "mkt-1",
    postingId: "post-1",
    studentId: "stu-1",
    track: "standard",
    status: "submitted",
    submittedOn: "2026-01-10T00:00:00Z",
    statusSince: "2026-01-10T00:00:00Z",
    matchScore: { score: 90, algorithmVersion: "match-v1", factors: [] },
    version: 1,
    ...over,
  };
}

function student(over: Partial<Student> = {}): Student {
  return {
    id: "stu-1",
    marketId: "mkt-1",
    userId: "u-student",
    collegeId: "org-college",
    name: "Test Student",
    email: "student@example.edu",
    programOfStudy: "Computer Science",
    classStanding: "Junior",
    expectedGraduation: "2027-05",
    skills: ["JavaScript"],
    interests: [],
    availableHoursPerWeek: 20,
    status: "verified",
    eligibility: "not_determined",
    eligibilityDeterminedOn: null,
    eligibilityExpiresOn: null,
    verifiedOn: "2026-01-01T00:00:00Z",
    ...over,
  };
}

function ctx(
  app: Application,
  stu = student(),
  remainingBudget = 100_000,
  postingOwnerId = "org-business",
  unreviewedWeeks = 0,
) {
  return {
    application: app,
    student: stu,
    remainingBudget,
    postingOwnerId,
    unreviewedWeeks,
  };
}

// --- role enforcement ------------------------------------------------------

describe("role enforcement", () => {
  it("lets a business shortlist a candidate under review", () => {
    const app = application({ status: "under_review" });
    const result = attemptTransition(actor("business"), ctx(app), "shortlisted");
    expect(result.ok).toBe(true);
  });

  it("refuses to let a student shortlist themselves", () => {
    const app = application({ status: "under_review" });
    const result = attemptTransition(actor("student"), ctx(app), "shortlisted");
    expect(result.ok).toBe(false);
    expect(result.error).toContain("may not perform");
  });

  it("refuses a transition that does not exist from the current status", () => {
    const app = application({ status: "submitted" });
    const result = attemptTransition(actor("business"), ctx(app), "credit_granted");
    expect(result.ok).toBe(false);
    expect(result.error).toContain("No transition");
  });

  it("refuses an actor from a different market", () => {
    const app = application({ marketId: "mkt-2", status: "under_review" });
    const result = attemptTransition(actor("business", "mkt-1"), ctx(app), "shortlisted");
    expect(result.ok).toBe(false);
    expect(result.error).toContain("not a member of this market");
  });
});

// --- organization ownership ------------------------------------------------
// Sharing a market is not authorization. Without this a business could act on
// a competitor's candidate.

describe("organization ownership", () => {
  it("refuses a business acting on another organization's posting", () => {
    const app = application({ status: "under_review" });
    const result = attemptTransition(
      actor("business"),
      ctx(app, student(), 100_000, "org-someone-else"),
      "shortlisted",
    );
    expect(result.ok).toBe(false);
    expect(result.error).toContain("another organization's posting");
  });

  it("allows a business acting on its own posting", () => {
    const app = application({ status: "under_review" });
    const result = attemptTransition(
      actor("business"),
      ctx(app, student(), 100_000, "org-business"),
      "shortlisted",
    );
    expect(result.ok).toBe(true);
  });

  it("refuses a student acting on someone else's application", () => {
    const app = application({ status: "shortlisted" });
    const stu = student({ userId: "u-someone-else" });
    const result = attemptTransition(actor("student"), ctx(app, stu), "mutual_interest");
    expect(result.ok).toBe(false);
    expect(result.error).toContain("their own applications");
  });

  it("allows a student acting on their own application", () => {
    const app = application({ status: "shortlisted" });
    const stu = student({ userId: "u-student" });
    const result = attemptTransition(actor("student"), ctx(app, stu), "mutual_interest");
    expect(result.ok).toBe(true);
  });

  it("lets a college act across its market without owning the posting", () => {
    const app = application({ status: "placement_active" });
    const result = attemptTransition(
      actor("college"),
      ctx(app, student(), 100_000, "org-someone-else"),
      "terminated_early",
    );
    expect(result.ok).toBe(true);
  });

  it("offers no transitions at all to a business on a foreign posting", () => {
    const app = application({ status: "under_review" });
    const options = availableTransitions(
      actor("business"),
      ctx(app, student(), 100_000, "org-someone-else"),
    );
    expect(options).toHaveLength(0);
  });
});

// --- track divergence ------------------------------------------------------

describe("track workflow profiles", () => {
  it("routes a standard application through the board", () => {
    const app = application({ status: "mutual_interest", track: "standard" });
    const result = attemptTransition(actor("student"), ctx(app), "interview_scheduled");
    expect(result.ok).toBe(true);
  });

  it("does not route a micro-internship through the board", () => {
    const app = application({ status: "mutual_interest", track: "micro" });
    const result = attemptTransition(actor("student"), ctx(app), "interview_scheduled");
    expect(result.ok).toBe(false);
    expect(result.error).toContain("micro track");
  });

  it("lets a micro-internship go from mutual interest straight to work", () => {
    const app = application({ status: "mutual_interest", track: "micro" });
    const result = attemptTransition(actor("business"), ctx(app), "placement_active");
    expect(result.ok).toBe(true);
  });

  it("does not let a standard application skip the board", () => {
    const app = application({ status: "mutual_interest", track: "standard" });
    const result = attemptTransition(actor("business"), ctx(app), "placement_active");
    expect(result.ok).toBe(false);
  });
});

// --- guards ----------------------------------------------------------------

describe("guards", () => {
  it("blocks booking an interview for a student already found ineligible", () => {
    const app = application({ status: "mutual_interest" });
    const stu = student({ eligibility: "not_eligible" });
    const result = attemptTransition(actor("student"), ctx(app, stu), "interview_scheduled");
    expect(result.ok).toBe(false);
    expect(result.error).toContain("ineligible");
  });

  it("still requires an interview for a student cleared on a previous job", () => {
    // Clearance is per applicant per job, so a prior determination does not
    // let this application skip the board.
    const app = application({ status: "mutual_interest" });
    const stu = student({ eligibility: "eligible" });
    const result = attemptTransition(actor("board"), ctx(app, stu), "cleared");
    expect(result.ok).toBe(false);
    expect(result.error).toContain("No transition");
  });

  it("routes an already-cleared student to a fresh interview", () => {
    const app = application({ status: "mutual_interest" });
    const stu = student({ eligibility: "eligible" });
    const result = attemptTransition(actor("student"), ctx(app, stu), "interview_scheduled");
    expect(result.ok).toBe(true);
  });

  it("refuses a funding authorization that exceeds the remaining budget", () => {
    const app = application({
      status: "cleared",
      fundingAuthorizedHours: 400,
      fundingAuthorizedRate: 20,
    });
    const result = attemptTransition(
      actor("board"),
      ctx(app, student(), 5_000),
      "funding_authorized",
    );
    expect(result.ok).toBe(false);
    expect(result.error).toContain("exceeds");
  });

  it("allows a funding authorization the budget covers", () => {
    const app = application({
      status: "cleared",
      fundingAuthorizedHours: 400,
      fundingAuthorizedRate: 20,
    });
    const result = attemptTransition(
      actor("board"),
      ctx(app, student(), 50_000),
      "funding_authorized",
    );
    expect(result.ok).toBe(true);
  });

  it("refuses to complete a standard placement with no approved hours", () => {
    const app = application({ status: "placement_active", hoursApproved: 0 });
    const result = attemptTransition(actor("business"), ctx(app), "placement_completed");
    expect(result.ok).toBe(false);
    expect(result.error).toContain("No approved hours");
  });

  it("refuses to complete a placement over the student's unreviewed weeks", () => {
    // Closing here strands those hours: they never reach the credit total and
    // never reach the board's claim, and a student cannot reopen a completed
    // placement to chase them. The employer sitting on the queue is the one
    // who can clear it.
    const app = application({ status: "placement_active", hoursApproved: 120 });
    const result = attemptTransition(
      actor("business"),
      ctx(app, student(), 100_000, "org-business", 2),
      "placement_completed",
    );

    expect(result.ok).toBe(false);
    expect(result.error).toContain("2 weeks of logged hours still need your approval");
  });

  it("allows completion once every week has been reviewed", () => {
    const app = application({ status: "placement_active", hoursApproved: 120 });
    const result = attemptTransition(
      actor("business"),
      ctx(app, student(), 100_000, "org-business", 0),
      "placement_completed",
    );

    expect(result.ok).toBe(true);
  });

  it("refuses to accept a micro deliverable that was never submitted", () => {
    const app = application({
      status: "placement_active",
      track: "micro",
      deliverableSubmitted: false,
    });
    const result = attemptTransition(actor("business"), ctx(app), "placement_completed");
    expect(result.ok).toBe(false);
    expect(result.error).toContain("not submitted");
  });
});

// --- the unsubsidized path is not a dead end -------------------------------

describe("unsubsidized path", () => {
  it("lets a placement proceed after the board declines funding", () => {
    const app = application({ status: "unsubsidized" });
    const result = attemptTransition(actor("business"), ctx(app), "placement_active");
    expect(result.ok).toBe(true);
  });

  it("reaches unsubsidized when a student is found not eligible", () => {
    const app = application({ status: "interview_completed" });
    const result = attemptTransition(actor("board"), ctx(app), "unsubsidized");
    expect(result.ok).toBe(true);
  });
});

// --- admin override --------------------------------------------------------

describe("administrator override", () => {
  it("lets an admin force a transition their role would not normally allow", () => {
    const app = application({ status: "under_review" });
    const result = attemptTransition(
      actor("admin"),
      ctx(app),
      "shortlisted",
      "Business unresponsive for 21 days; college confirmed by phone",
    );
    expect(result.ok).toBe(true);
    expect(result.viaOverride).toBe(true);
  });

  it("requires a reason for an override", () => {
    const app = application({ status: "under_review" });
    const result = attemptTransition(actor("admin"), ctx(app), "shortlisted");
    expect(result.ok).toBe(false);
    expect(result.error).toContain("requires a reason");
  });

  it("does not flag an override when the admin holds the role legitimately", () => {
    const app = application({ status: "placement_active", track: "micro", deliverableSubmitted: true });
    const result = attemptTransition(actor("admin"), ctx(app), "placement_completed");
    expect(result.viaOverride).toBeUndefined();
  });

  it("still refuses a transition that does not exist at all", () => {
    const app = application({ status: "submitted" });
    const result = attemptTransition(actor("admin"), ctx(app), "credit_granted", "because");
    expect(result.ok).toBe(false);
  });
});

// --- what portals render ---------------------------------------------------

describe("availableTransitions", () => {
  it("offers a business nothing on an application awaiting the board", () => {
    const app = application({ status: "interview_scheduled" });
    expect(availableTransitions(actor("business"), ctx(app))).toHaveLength(0);
  });

  it("hides guard-failing transitions from the actor's options", () => {
    const app = application({ status: "mutual_interest" });
    const stu = student({ eligibility: "not_eligible" });
    const options = availableTransitions(actor("student"), ctx(app, stu));
    expect(options.map((t) => t.to)).not.toContain("interview_scheduled");
  });

  it("offers the board nothing until a student books an interview", () => {
    const app = application({ status: "mutual_interest" });
    expect(availableTransitions(actor("board"), ctx(app))).toHaveLength(0);
  });

  it("shows the admin everything defined from a status", () => {
    const app = application({ status: "under_review" });
    const all = transitionsFrom("under_review", "standard");
    expect(availableTransitions(actor("admin"), ctx(app))).toHaveLength(all.length);
  });
});

// --- reporting helpers -----------------------------------------------------

describe("reporting helpers", () => {
  it("treats the whole clearance sequence as the pause", () => {
    expect(PAUSE_STATUSES).toContain("mutual_interest");
    expect(PAUSE_STATUSES).toContain("interview_scheduled");
    expect(PAUSE_STATUSES).not.toContain("placement_active");
  });

  it("measures dwell time from when the status was entered", () => {
    const app = application({ statusSince: "2026-01-01T00:00:00Z" });
    expect(daysInStatus(app, new Date("2026-01-15T00:00:00Z"))).toBe(14);
  });

  it("computes a funding commitment from the authorized cap and rate", () => {
    const app = application({ fundingAuthorizedHours: 400, fundingAuthorizedRate: 20 });
    expect(fundingCommitment(app)).toBe(8_000);
  });

  it("reports no commitment for an unauthorized application", () => {
    expect(fundingCommitment(application())).toBe(0);
  });
});

// --- reachability ----------------------------------------------------------

describe("machine integrity", () => {
  function walk(track: Track): Set<ApplicationStatus> {
    const seen = new Set<ApplicationStatus>(["submitted"]);
    const queue: ApplicationStatus[] = ["submitted"];
    while (queue.length) {
      const status = queue.shift()!;
      for (const t of transitionsFrom(status, track)) {
        if (!seen.has(t.to)) {
          seen.add(t.to);
          queue.push(t.to);
        }
      }
    }
    return seen;
  }

  it("can reach granted credit on the standard track", () => {
    expect(walk("standard").has("credit_granted")).toBe(true);
  });

  it("can reach granted credit on the micro track", () => {
    expect(walk("micro").has("credit_granted")).toBe(true);
  });

  it("never reaches board states on the micro track", () => {
    const reachable = walk("micro");
    expect(reachable.has("interview_scheduled")).toBe(false);
    expect(reachable.has("funding_authorized")).toBe(false);
  });

  it("has no transition out of a closed application", () => {
    expect(transitionsFrom("closed", "standard")).toHaveLength(0);
    expect(transitionsFrom("closed", "micro")).toHaveLength(0);
  });
});
