/**
 * Write-path tests.
 *
 * These run against the seeded fixtures and mutate them, so each test restores
 * what it touched. That is itself a useful property to have proven: a failed
 * transition must leave no trace.
 */

import { describe, it, expect, beforeEach } from "vitest";
import { executeTransition } from "./transitions";
import { contextFor } from "@/data/session";
import { repositories } from "@/data/memory";
import { memoryStore, pendingNotifications } from "@/data/memory-store";
import * as seed from "@/data/seed";
import type { Application } from "@/domain/types";

const student = contextFor("student");
const business = contextFor("business");
const board = contextFor("board");
const admin = contextFor("admin");

/** Snapshot and restore, so tests stay independent of execution order. */
let snapshot: Application[];

beforeEach(() => {
  snapshot = seed.applications.map((a) => ({ ...a }));
  seed.slotOverrides.clear();
  pendingNotifications.length = 0;
  seed.auditEvents.length = 5;
  return () => {
    seed.applications.splice(0, seed.applications.length, ...snapshot);
  };
});

function find(id: string) {
  return seed.applications.find((a) => a.id === id)!;
}

describe("authorization is re-checked on the write path", () => {
  it("refuses a business acting on a competitor's application", async () => {
    // app-2 is against a Cherokee Valley posting; the actor is Apex.
    const result = await executeTransition(business, {
      applicationId: "app-2",
      to: "placement_completed",
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("not_found");
  });

  it("refuses a student moving an application that is not theirs", async () => {
    // app-5 belongs to Marcus Bell; the signed-in student is Omar.
    const result = await executeTransition(student, {
      applicationId: "app-5",
      to: "interview_scheduled",
    });
    expect(result.ok).toBe(false);
  });

  it("refuses a transition the state machine does not define", async () => {
    const result = await executeTransition(student, {
      applicationId: "app-4",
      to: "credit_granted",
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("forbidden");
  });

  it("requires a reason for an administrator override", async () => {
    const result = await executeTransition(admin, {
      applicationId: "app-9",
      to: "shortlisted",
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain("requires a reason");
  });

  it("permits an override that carries a reason, and flags it", async () => {
    const result = await executeTransition(admin, {
      applicationId: "app-9",
      to: "shortlisted",
      reason: "Business unresponsive 14 days; college confirmed by phone",
    });
    expect(result.ok).toBe(true);
    expect(seed.auditEvents[0].viaOverride).toBe(true);
    expect(seed.auditEvents[0].reason).toContain("unresponsive");
  });
});

describe("a refused transition leaves no trace", () => {
  it("does not change status, audit, or notifications", async () => {
    const before = { ...find("app-4") };
    const auditBefore = seed.auditEvents.length;

    await executeTransition(student, { applicationId: "app-4", to: "credit_granted" });

    expect(find("app-4").status).toBe(before.status);
    expect(find("app-4").version).toBe(before.version);
    expect(seed.auditEvents).toHaveLength(auditBefore);
    expect(pendingNotifications).toHaveLength(0);
  });
});

describe("a successful transition writes everything together", () => {
  it("moves the application, stamps the time, and bumps the version", async () => {
    const before = { ...find("app-4") };
    const result = await executeTransition(student, {
      applicationId: "app-4",
      to: "interview_scheduled",
      patch: { interviewSlotId: "slot-1" },
    });

    expect(result.ok).toBe(true);
    const after = find("app-4");
    expect(after.status).toBe("interview_scheduled");
    expect(after.version).toBe(before.version + 1);
    expect(new Date(after.statusSince).getTime()).toBeGreaterThan(
      new Date(before.statusSince).getTime(),
    );
    expect(after.interviewSlotId).toBe("slot-1");
  });

  it("appends an audit record naming the actor and both states", async () => {
    await executeTransition(student, {
      applicationId: "app-4",
      to: "interview_scheduled",
    });
    const event = seed.auditEvents[0];
    expect(event.entityId).toBe("app-4");
    expect(event.from).toBe("mutual_interest");
    expect(event.to).toBe("interview_scheduled");
    expect(event.actorUserId).toBe(student.user.id);
    expect(event.actorRole).toBe("student");
    expect(event.viaOverride).toBe(false);
  });

  it("queues notifications rather than sending them inline", async () => {
    await executeTransition(student, {
      applicationId: "app-4",
      to: "interview_scheduled",
      notifications: () => [{ recipientUserId: "u-marcia", kind: "custom.extra" }],
    });
    // Nothing was sent during the transaction; everything is queued for the
    // drain that runs after it commits.
    expect(pendingNotifications.length).toBeGreaterThan(0);
    expect(pendingNotifications.some((n) => n.kind === "custom.extra")).toBe(true);
  });

  it("applies the notification policy without the caller asking", async () => {
    // The point of the policy table: booking an interview tells the student,
    // the board, and the employer, and the action that triggered it does not
    // have to know that. Before this, a transition notified whoever its call
    // site remembered to list — so the interesting steps had messages and the
    // rest had silence.
    await executeTransition(student, { applicationId: "app-4", to: "interview_scheduled" });

    const kinds = pendingNotifications.map((n) => n.kind);
    expect(kinds).toContain("interview.booked.student");
    expect(kinds).toContain("interview.booked.board");
    expect(kinds).toContain("interview.booked.employer");
  });

  it("does not send the same message twice when a caller repeats the policy", async () => {
    await executeTransition(student, {
      applicationId: "app-4",
      to: "interview_scheduled",
      notifications: () => [
        {
          recipientUserId: "contact:org-prairieridge",
          recipientOrganizationId: "org-prairieridge",
          kind: "interview.booked.employer",
        },
      ],
    });

    const employerMessages = pendingNotifications.filter(
      (n) => n.kind === "interview.booked.employer",
    );
    expect(employerMessages).toHaveLength(1);
  });

  it("passes the whole intent through rather than rebuilding it", async () => {
    // This rebuilt the intent field by field, which silently dropped
    // `recipientOrganizationId` — so every message addressed to an employer or
    // board rendered without an address and was recorded undeliverable. The
    // transition still succeeded, which is what made it invisible: the state
    // moved and nobody was told.
    await executeTransition(student, { applicationId: "app-4", to: "interview_scheduled" });

    const employer = pendingNotifications.find(
      (n) => n.kind === "interview.booked.employer",
    );
    expect(employer?.recipientOrganizationId).toBeTruthy();
  });

  it("stamps the market from the application, not the caller", async () => {
    await executeTransition(student, {
      applicationId: "app-4",
      to: "interview_scheduled",
      notifications: () => [{ recipientUserId: "u-marcia", kind: "custom.extra" }],
    });
    // A notification belongs to the market of the thing that caused it, so a
    // caller cannot address one into someone else's market.
    const marketId = find("app-4").marketId;
    expect(pendingNotifications.every((n) => n.marketId === marketId)).toBe(true);
  });

  it("records how far a closed application got", async () => {
    await executeTransition(board, {
      applicationId: "app-8",
      to: "funding_authorized",
      patch: { fundingAuthorizedHours: 100, fundingAuthorizedRate: 20 },
    });
    expect(find("app-8").furthestStatus).toBe("funding_authorized");
  });
});

describe("side effects share the transaction", () => {
  it("claims the slot and moves the application together", async () => {
    const slot = repositories.interviewSlots.open(student)[0];
    await executeTransition(student, {
      applicationId: "app-4",
      to: "interview_scheduled",
      sideEffects: (uow, moved) => {
        uow.saveInterviewSlot(
          { ...slot, bookedByStudentId: moved.studentId, bookedAt: "now" },
          slot.version,
        );
      },
    });

    expect(find("app-4").status).toBe("interview_scheduled");
    const booked = repositories.interviewSlots
      .list(student)
      .find((s) => s.id === slot.id);
    expect(booked?.bookedByStudentId).toBe("stu-omar");
  });

  it("rolls the application back when a side effect fails", async () => {
    const slot = repositories.interviewSlots.open(student)[0];
    const before = { ...find("app-4") };

    await expect(
      executeTransition(student, {
        applicationId: "app-4",
        to: "interview_scheduled",
        sideEffects: (uow) => {
          // Stale version: someone else booked this slot first.
          uow.saveInterviewSlot({ ...slot, bookedByStudentId: "stu-other" }, 99);
        },
      }),
    ).resolves.toMatchObject({ ok: false, code: "conflict" });

    expect(find("app-4").status).toBe(before.status);
    expect(find("app-4").version).toBe(before.version);
  });
});

describe("optimistic concurrency", () => {
  it("rejects a write against a stale version", async () => {
    const application = find("app-4");
    await expect(
      memoryStore.transaction((uow) => {
        uow.saveApplication(application, application.version - 1);
      }),
    ).rejects.toThrow(/changed by someone else/);
  });

  it("lets the second of two racing transitions fail cleanly", async () => {
    const first = await executeTransition(student, {
      applicationId: "app-4",
      to: "interview_scheduled",
    });
    expect(first.ok).toBe(true);

    // The same move again: the application has already left mutual_interest.
    const second = await executeTransition(student, {
      applicationId: "app-4",
      to: "interview_scheduled",
    });
    expect(second.ok).toBe(false);
  });
});
