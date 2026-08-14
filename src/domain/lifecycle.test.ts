import { describe, it, expect } from "vitest";
import type {
  ActorContext,
  ActorRole,
  Organization,
  Posting,
  Student,
} from "./types";
import {
  ORGANIZATION_TRANSITIONS,
  POSTING_TRANSITIONS,
  STUDENT_TRANSITIONS,
  canApply,
  canTransact,
  organizationMachine,
  postingMachine,
  studentMachine,
  transactBlockReason,
} from "./lifecycle";

const MARKET = "mkt-1";

function actor(role: ActorRole, overrides: Partial<ActorContext["membership"]> = {}) {
  return {
    user: { id: "u-1", name: "Test", email: "t@example.test" },
    membership: {
      id: "mem-1",
      userId: "u-1",
      organizationId: "org-1",
      marketId: MARKET,
      role,
      ...overrides,
    },
  } as ActorContext;
}

function student(overrides: Partial<Student> = {}): Student {
  return {
    id: "stu-1",
    marketId: MARKET,
    userId: "u-1",
    collegeId: "org-college",
    name: "Test Student",
    email: "s@example.test",
    programOfStudy: "Welding",
    classStanding: "Sophomore",
    expectedGraduation: "2027",
    skills: ["MIG"],
    interests: [],
    availableHoursPerWeek: 15,
    status: "pending_verification",
    eligibility: "not_determined",
    eligibilityDeterminedOn: null,
    eligibilityExpiresOn: null,
    verifiedOn: null,
    ...overrides,
  };
}

function posting(overrides: Partial<Posting> = {}): Posting {
  return {
    id: "post-1",
    marketId: MARKET,
    businessId: "org-1",
    track: "standard",
    title: "Intern",
    description: "Real work.",
    county: "Crawford",
    skillsRequired: ["MIG"],
    skillsPreferred: [],
    status: "pending_review",
    openings: 1,
    createdOn: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

function organization(overrides: Partial<Organization> = {}): Organization {
  return {
    id: "org-1",
    marketId: MARKET,
    kind: "business",
    name: "Test Manufacturing",
    county: "Crawford",
    status: "under_review",
    contactName: "Pat",
    contactEmail: "pat@example.test",
    appliedOn: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

// ---------------------------------------------------------------------------

describe("student verification", () => {
  it("lets the college verify a student who asked to be checked", () => {
    const result = studentMachine.attempt(
      actor("college"),
      { student: student() },
      "verified",
    );
    expect(result.ok).toBe(true);
  });

  it("does not let a student verify themselves", () => {
    // The employer's entire basis for trusting a candidate list is that a
    // college stood behind it.
    const result = studentMachine.attempt(
      actor("student"),
      { student: student() },
      "verified",
    );

    expect(result.ok).toBe(false);
    expect(result.error).toContain("may not perform");
  });

  it("does not let a college verify a student in another market", () => {
    const result = studentMachine.attempt(
      actor("college", { marketId: "mkt-other" }),
      { student: student() },
      "verified",
    );

    expect(result.ok).toBe(false);
    expect(result.error).toContain("not a member of this market");
  });

  it("does not let a student act on someone else's record", () => {
    const result = studentMachine.attempt(
      actor("student"),
      { student: student({ userId: "u-someone-else", status: "profile_complete" }) },
      "pending_verification",
    );

    expect(result.ok).toBe(false);
    expect(result.error).toContain("their own record");
  });

  it("refuses to complete a profile that is not complete", () => {
    const result = studentMachine.attempt(
      actor("student"),
      { student: student({ status: "registered", skills: [] }) },
      "profile_complete",
    );

    expect(result.ok).toBe(false);
    expect(result.error).toContain("at least one skill");
  });

  it("lets a rejected student try again rather than start over", () => {
    // A student who was not enrolled last term may be this one, and
    // re-registering would lose their application history with their profile.
    const result = studentMachine.attempt(
      actor("college"),
      { student: student({ status: "verification_rejected" }) },
      "pending_verification",
    );

    expect(result.ok).toBe(true);
  });

  it("gates applying on verification, and on nothing else", () => {
    expect(canApply(student({ status: "verified" }))).toBe(true);
    for (const status of [
      "registered",
      "profile_complete",
      "pending_verification",
      "verification_rejected",
      "inactive",
    ] as const) {
      expect(canApply(student({ status })), status).toBe(false);
    }
  });
});

describe("posting publication", () => {
  it("lets the college publish a reviewed posting", () => {
    const result = postingMachine.attempt(
      actor("college"),
      { posting: posting(), openApplications: 0 },
      "published",
    );
    expect(result.ok).toBe(true);
  });

  it("does not let an employer publish their own posting", () => {
    // Review is what makes a posting credit-bearing. An employer who could
    // publish directly would bypass the judgement that gives credit meaning.
    const result = postingMachine.attempt(
      actor("business"),
      { posting: posting(), openApplications: 0 },
      "published",
    );

    expect(result.ok).toBe(false);
    expect(result.error).toContain("may not perform");
  });

  it("refuses to publish a posting that will match nobody", () => {
    const result = postingMachine.attempt(
      actor("college"),
      { posting: posting({ skillsRequired: [] }), openApplications: 0 },
      "published",
    );

    expect(result.ok).toBe(false);
    expect(result.error).toContain("will not match anyone");
  });

  it("does not let an employer touch a competitor's posting", () => {
    const result = postingMachine.attempt(
      actor("business", { organizationId: "org-competitor" }),
      { posting: posting({ status: "draft" }), openApplications: 0 },
      "help_requested",
    );

    expect(result.ok).toBe(false);
    expect(result.error).toContain("another organization");
  });

  it("refuses to close a posting with candidates still in its pipeline", () => {
    // Closing over live applications strands people mid-process with no
    // posting to point at.
    const result = postingMachine.attempt(
      actor("business"),
      { posting: posting({ status: "published" }), openApplications: 3 },
      "closed",
    );

    expect(result.ok).toBe(false);
    expect(result.error).toContain("3 candidates are still");
  });

  it("closes cleanly once the pipeline is empty", () => {
    const result = postingMachine.attempt(
      actor("business"),
      { posting: posting({ status: "published" }), openApplications: 0 },
      "closed",
    );
    expect(result.ok).toBe(true);
  });

  it("routes the assisted-drafting path through the college", () => {
    const ctx = { posting: posting({ status: "help_requested" }), openApplications: 0 };
    expect(postingMachine.attempt(actor("college"), ctx, "college_drafting").ok).toBe(
      true,
    );
    expect(postingMachine.attempt(actor("business"), ctx, "college_drafting").ok).toBe(
      false,
    );
  });

  it("reopens a filled posting rather than making it be rewritten", () => {
    const result = postingMachine.attempt(
      actor("business"),
      { posting: posting({ status: "filled" }), openApplications: 0 },
      "published",
    );
    expect(result.ok).toBe(true);
  });
});

describe("organization vetting", () => {
  it("is the administrator's alone", () => {
    const ctx = { organization: organization() };

    expect(organizationMachine.attempt(actor("admin"), ctx, "approved").ok).toBe(true);
    for (const role of ["business", "college", "board", "student"] as const) {
      expect(
        organizationMachine.attempt(actor(role), ctx, "approved").ok,
        role,
      ).toBe(false);
    }
  });

  it("has no self-service path from applied to approved", () => {
    // An organization that could approve itself is one nobody vetted. Even the
    // administrator has to open the file first.
    const result = organizationMachine.attempt(
      actor("admin"),
      { organization: organization({ status: "applied" }) },
      "approved",
    );

    expect(result.ok).toBe(false);
    expect(result.error).toContain("No transition from applied to approved");
  });

  it("refuses to approve an organization with no contact, and says why", () => {
    // Vetting is admin-only, so the administrator is the only caller a guard
    // here can ever refuse. That means they always land on the override path —
    // and if the refusal only said "requires a reason" they would be asked to
    // justify a decision the product never described.
    const result = organizationMachine.attempt(
      actor("admin"),
      { organization: organization({ contactEmail: "  " }) },
      "approved",
    );

    expect(result.ok).toBe(false);
    expect(result.error).toContain("contact we can reach");
    expect(result.error).toContain("requires a reason");
  });

  it("gates transacting on approval", () => {
    expect(canTransact(organization({ status: "approved" }))).toBe(true);
    expect(canTransact(organization({ status: "active" }))).toBe(true);
    for (const status of [
      "applied",
      "under_review",
      "info_requested",
      "suspended",
      "rejected",
    ] as const) {
      expect(canTransact(organization({ status })), status).toBe(false);
    }
  });

  it("tells a suspended organization something other than 'not approved'", () => {
    // Telling them they are unapproved invites them to apply again, which is
    // not the remedy.
    const suspended = transactBlockReason(organization({ status: "suspended" }));
    expect(suspended).toContain("suspended");
    expect(suspended).not.toContain("still being vetted");
  });

  it("says nothing about an organization that can transact", () => {
    expect(transactBlockReason(organization({ status: "active" }))).toBeNull();
  });
});

describe("every machine", () => {
  const TABLES = {
    student: STUDENT_TRANSITIONS,
    posting: POSTING_TRANSITIONS,
    organization: ORGANIZATION_TRANSITIONS,
  };

  it.each(Object.entries(TABLES))("%s: names a role on every transition", (_, table) => {
    // A transition with no roles is unreachable except by administrator
    // override, which is never what anyone meant to write.
    for (const t of table) {
      expect(t.roles.length, `${t.from} → ${t.to}`).toBeGreaterThan(0);
    }
  });

  it.each(Object.entries(TABLES))("%s: has no duplicate edges", (_, table) => {
    const edges = table.map((t) => `${t.from}→${t.to}`);
    expect(new Set(edges).size).toBe(edges.length);
  });

  it.each(Object.entries(TABLES))("%s: never transitions to itself", (_, table) => {
    expect(table.filter((t) => t.from === t.to)).toEqual([]);
  });

  it("lets an administrator override a guard, but only with a reason", () => {
    const ctx = { posting: posting({ skillsRequired: [] }), openApplications: 0 };

    const bare = postingMachine.attempt(actor("admin"), ctx, "published");
    expect(bare.ok).toBe(false);
    expect(bare.error).toContain("requires a reason");

    const explained = postingMachine.attempt(
      actor("admin"),
      ctx,
      "published",
      "Skills are listed in the description; employer is mid-migration.",
    );
    expect(explained.ok).toBe(true);
    expect(explained.viaOverride).toBe(true);
  });

  it("shows an administrator the moves they would have to override", () => {
    // Hiding them would mean the person whose job is unsticking things cannot
    // see what is stuck.
    const offered = postingMachine.available(actor("admin"), {
      posting: posting({ skillsRequired: [] }),
      openApplications: 0,
    });
    expect(offered.some((t) => t.to === "published")).toBe(true);
  });

  it("offers a non-admin only what would actually succeed", () => {
    const offered = postingMachine.available(actor("college"), {
      posting: posting({ skillsRequired: [] }),
      openApplications: 0,
    });
    expect(offered.some((t) => t.to === "published")).toBe(false);
    expect(offered.some((t) => t.to === "changes_requested")).toBe(true);
  });
});
