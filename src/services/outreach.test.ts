/**
 * The chase-queue nudge.
 *
 * Writes an audit entry and queues a message, so every test records what it
 * added and takes it out again — the reporting suites count audit entries.
 */

import { describe, it, expect, afterEach } from "vitest";
import { sendFollowUpNudge } from "./outreach";
import type { Store } from "@/data/store";
import { TEMPLATES } from "./templates";
import { contextFor } from "@/data/session";
import { hasExited } from "@/domain/outcome";
import * as seed from "@/data/seed";

const before = seed.auditEvents.length;

afterEach(() => {
  // From the front. `appendAuditEvent` unshifts — the log is newest-first —
  // so anything a test added is at the head, and splicing the tail would
  // delete the fixtures and leave the test's own entries behind.
  seed.auditEvents.splice(0, seed.auditEvents.length - before);
});

const admin = () => contextFor("admin");
const college = () => contextFor("college");
const business = () => contextFor("business");
const board = () => contextFor("board");
const student = () => contextFor("student");

/** Any placement that has ended, which is the only kind this asks about. */
function finished() {
  const application = seed.applications.find(hasExited);
  if (!application) throw new Error("no finished placement in the seed");
  return application;
}

describe("who may send one", () => {
  it("is the administrator", async () => {
    const result = await sendFollowUpNudge(admin(), {
      applicationId: finished().id,
      audience: "employer",
    });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.sentTo).toBe("employer");
  });

  it("is nobody else", async () => {
    // The college works its own follow-up queue from its own portal and does
    // not need a second route to the same people; the board has no business
    // chasing either party; and the employer is the subject of the question
    // rather than a sender of it.
    for (const actor of [college(), business(), board(), student()]) {
      const result = await sendFollowUpNudge(actor, {
        applicationId: finished().id,
        audience: "employer",
      });
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.code).toBe("forbidden");
    }
  });
});

describe("what it refuses", () => {
  it("refuses a placement that has not finished", async () => {
    // A message asking how a live placement ended is how an employer learns
    // these are sent by a machine that is not reading the record.
    const running = seed.applications.find((a) => a.status === "placement_active")!;
    const result = await sendFollowUpNudge(admin(), {
      applicationId: running.id,
      audience: "learner",
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/has not finished/);
  });

  it("refuses a placement that does not exist", async () => {
    const result = await sendFollowUpNudge(admin(), {
      applicationId: "app-nope",
      audience: "employer",
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("not_found");
  });
});

describe("what it queues", () => {
  it("sends the employer's to the organization's contact", async () => {
    const application = finished();
    const posting = seed.postings.find((p) => p.id === application.postingId)!;
    const queued: unknown[] = [];

    await sendFollowUpNudge(
      admin(),
      { applicationId: application.id, audience: "employer" },
      {
        now: () => new Date(),
        store: {
          transaction: async (work) =>
            work({
              enqueueNotification: (intent: unknown) => queued.push(intent),
              appendAuditEvent: () => {},
            } as never),
        } as Store,
      },
    );

    expect(queued).toHaveLength(1);
    const intent = queued[0] as {
      kind: string;
      recipientOrganizationId?: string;
      payload: Record<string, unknown>;
    };
    expect(intent.kind).toBe("followup.employer");
    expect(intent.recipientOrganizationId).toBe(posting.businessId);
    // The reference and the job title, and nothing else. The job title is the
    // employer's own words about its own role — the same category as a board
    // officer's name on an interview slot, which the rules explicitly keep.
    expect(Object.keys(intent.payload).sort()).toEqual(["applicationId", "postingTitle"]);
  });

  it("sends the learner's to the learner, not to an organization", async () => {
    const application = finished();
    const learner = seed.students.find((s) => s.id === application.studentId)!;
    const queued: unknown[] = [];

    await sendFollowUpNudge(
      admin(),
      { applicationId: application.id, audience: "learner" },
      {
        now: () => new Date(),
        store: {
          transaction: async (work) =>
            work({
              enqueueNotification: (intent: unknown) => queued.push(intent),
              appendAuditEvent: () => {},
            } as never),
        } as Store,
      },
    );

    const intent = queued[0] as {
      kind: string;
      recipientUserId: string;
      recipientOrganizationId?: string;
    };
    expect(intent.kind).toBe("followup.learner");
    expect(intent.recipientUserId).toBe(learner.userId);
    expect(intent.recipientOrganizationId).toBeUndefined();
  });

  it("records that somebody was asked, because nothing else would", async () => {
    // The one action in this product whose entire effect is outside it. Without
    // the audit entry there is no way to answer "has anybody actually asked
    // them?", which is the question the chase queue exists to make answerable.
    const application = finished();
    await sendFollowUpNudge(admin(), {
      applicationId: application.id,
      audience: "learner",
    });

    const event = seed.auditEvents[0];
    expect(event?.entityId).toBe(application.id);
    expect(event?.to).toBe("nudged:learner");
    expect(event?.actorUserId).toBe(admin().user.id);
  });
});

describe("what the message says", () => {
  it("names no learner, in either template, for any learner in the seed", async () => {
    // The rule every template obeys, asserted here rather than only in
    // `notification-privacy.test.ts` because these two are the templates most
    // likely to grow a name — they are the ones a person wanted a compose box
    // for. A subject line is the least protected part of an email.
    const payload = { applicationId: "app-21", postingTitle: "Utility billing reconciliation" };

    for (const kind of ["followup.employer", "followup.learner"]) {
      const message = TEMPLATES[kind](payload);
      const rendered = `${message.subject} ${message.body} ${message.notice ?? ""}`;
      for (const learner of seed.students) {
        expect(rendered, `${kind} leaked ${learner.name}`).not.toContain(learner.name);
        expect(rendered).not.toContain(learner.email);
      }
    }
  });

  it("carries the record reference so it can be sorted without a name", async () => {
    const message = TEMPLATES["followup.employer"]({ applicationId: "app-21" });
    expect(message.subject).toContain("APP-21");
  });

  it("puts the FERPA notice on the employer's and not on the learner's", async () => {
    // The redisclosure notice exists because an employer forwarding something
    // about a student has created a problem that traces back to this product.
    // A learner receiving a message about themselves has not.
    expect(TEMPLATES["followup.employer"]({}).notice).toBeTruthy();
    expect(TEMPLATES["followup.learner"]({}).notice).toBeUndefined();
  });

  it("never quotes the host's note", async () => {
    // The note is readable by its author and the administrator and nobody else.
    // A product that mails it onward has undone that with one button, which is
    // why these templates take no note in their payload at all.
    const withNote = TEMPLATES["followup.employer"]({
      applicationId: "app-21",
      note: "No headcount this year, but we would take them back.",
    });
    expect(withNote.body).not.toContain("No headcount");
  });
});
