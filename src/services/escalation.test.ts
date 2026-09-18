/**
 * The escalation path — raising a problem, and what becomes of it.
 *
 * These mutate the shared seed arrays, so each test puts back what it changed.
 *
 * The tests worth reading first are the visibility ones. Everything else here
 * checks a rule; those check the reason the feature exists, which is that the
 * party a problem is about cannot read it. A regression there does not fail
 * anything else in this file — the write path still works, the queue still
 * fills, the administrator still sees it — it just quietly turns the channel
 * into a comment box.
 */

import { describe, it, expect, afterEach } from "vitest";
import {
  acknowledgeEscalation,
  raiseEscalation,
  resolveEscalation,
  withdrawEscalation,
} from "./escalation";
import { contextFor } from "@/data/session";
import { repositories } from "@/data/backend";
import * as seed from "@/data/seed";
import { pendingNotifications } from "@/data/memory-store";
import { templateFor } from "./templates";

/** Everything queued so far, in order. The in-memory queue is an array. */
const queued = () => pendingNotifications.map((p) => p.intent);

const original = seed.escalations.map((e) => ({ ...e }));

afterEach(() => {
  seed.escalations.splice(0, seed.escalations.length, ...original.map((e) => ({ ...e })));
  for (const e of seed.auditEvents.filter((a) => a.entityType === "escalation")) {
    seed.auditEvents.splice(seed.auditEvents.indexOf(e), 1);
  }
});

const student = () => contextFor("student");
const business = () => contextFor("business");
const college = () => contextFor("college");
const board = () => contextFor("board");
const admin = () => contextFor("admin");

/** The learner's own live placement — `stu-omar` holds `app-4`. */
const OWN_APPLICATION = "app-4";
const SUMMARY = "Nobody has given me any work for two weeks now.";

describe("raising one", () => {
  it("lets a learner raise a problem about their own placement", async () => {
    const result = await raiseEscalation(student(), {
      applicationId: OWN_APPLICATION,
      kind: "supervision",
      summary: SUMMARY,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.updated.status).toBe("open");
    expect(result.updated.raisedByRole).toBe("student");
    expect(result.updated.acknowledgedOn).toBeNull();
  });

  it("lets an employer raise one too — the path runs both ways", async () => {
    const [own] = await repositories.applications.list(business());
    const result = await raiseEscalation(business(), {
      applicationId: own.id,
      kind: "academic",
      summary: "Her lab schedule changed and the hours will not add up.",
    });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.updated.raisedByRole).toBe("business");
  });

  it("records the administrator as the raiser when they take one by phone", async () => {
    // Not the learner, even though the learner is who rang. Who was speaking is
    // part of what was said, and the log must not imply they typed it.
    const result = await raiseEscalation(admin(), {
      applicationId: OWN_APPLICATION,
      kind: "pay",
      summary: "Rang in: has not been paid for three weeks of approved hours.",
    });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.updated.raisedByRole).toBe("admin");
  });

  it("refuses a placement the raiser cannot see", async () => {
    // `app-2` belongs to another learner. The repository refuses it first, so
    // this is `not_found` rather than a permission message that would confirm
    // the id exists.
    const result = await raiseEscalation(student(), {
      applicationId: "app-2",
      kind: "other",
      summary: "Something is wrong with somebody else's placement.",
    });
    expect(result).toMatchObject({ ok: false, code: "not_found" });
  });

  it("refuses a description too short to act on", async () => {
    const result = await raiseEscalation(student(), {
      applicationId: OWN_APPLICATION,
      kind: "safety",
      summary: "bad",
    });
    expect(result).toMatchObject({ ok: false, code: "forbidden" });
  });

  it("allows two people to report the same thing", async () => {
    // Corroboration rather than a duplicate — and the second account may be the
    // one that matters, since the first can come from the party at fault.
    const first = await raiseEscalation(student(), {
      applicationId: OWN_APPLICATION,
      kind: "supervision",
      summary: SUMMARY,
    });
    const second = await raiseEscalation(admin(), {
      applicationId: OWN_APPLICATION,
      kind: "supervision",
      summary: "Employer confirms the supervisor has been off since the 3rd.",
    });
    expect(first.ok && second.ok).toBe(true);
  });

  it("writes an audit entry naming the kind but never the summary", async () => {
    const result = await raiseEscalation(student(), {
      applicationId: OWN_APPLICATION,
      kind: "safety",
      summary: "There is no guard on the press I have been asked to run.",
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const entry = seed.auditEvents.find((e) => e.entityId === result.updated.id);
    expect(entry?.to).toBe("open · safety");
    // The audit log is the market's; the report is the raiser's and the
    // administrator's. Copying the text into a wider-readable table would undo
    // the visibility rule the whole feature rests on.
    expect(entry?.reason).toBeUndefined();
    expect(JSON.stringify(entry)).not.toContain("guard");
  });
});

describe("telling the administrator", () => {
  it("queues a message to every administrator", async () => {
    const before = queued().length;
    const result = await raiseEscalation(student(), {
      applicationId: OWN_APPLICATION,
      kind: "safety",
      summary: "There is no guard on the press I have been asked to run.",
    });
    expect(result.ok).toBe(true);

    const sent = queued().slice(before);
    const admins = await repositories.users.administrators();
    expect(admins.length).toBeGreaterThan(0);
    expect(sent.map((n) => n.recipientUserId).sort()).toEqual(
      admins.map((a) => a.id).sort(),
    );
    expect(sent.every((n) => n.kind === "escalation.raised")).toBe(true);
  });

  it("sends a pointer rather than the report", async () => {
    // The assertion this one exists for. Email is the least private channel
    // here — it leaves the platform when it is sent and reaches the employer
    // the report is about in one forward — so the message says a problem of
    // this kind exists and where to read it, and nothing else.
    const before = queued().length;
    await raiseEscalation(student(), {
      applicationId: OWN_APPLICATION,
      kind: "supervision",
      summary: "My supervisor has not been in for three weeks and I sit alone.",
    });

    const sent = queued().slice(before);
    expect(sent.length).toBeGreaterThan(0);
    for (const intent of sent) {
      const rendered = JSON.stringify(intent);
      expect(rendered).not.toContain("three weeks");
      expect(rendered).not.toContain("sit alone");
    }

    // And the rendered mail itself, not only the payload: a template is free to
    // put a field somewhere the payload check would not see.
    const template = templateFor("escalation.raised")!;
    const mail = template(sent[0].payload);
    expect(`${mail.subject} ${mail.body}`).not.toContain("supervisor has not been in");
    // It does say which kind, because that decides whether this is opened now.
    expect(mail.subject.toLowerCase()).toContain("supervision");
  });
});

describe("who can read one", () => {
  it("shows the administrator every report in the market", async () => {
    const all = await repositories.escalations.list(admin());
    expect(all.map((e) => e.id)).toEqual(
      expect.arrayContaining(["esc-1", "esc-2", "esc-3"]),
    );
  });

  it("hides a learner's report from the employer it is about", async () => {
    // `esc-1` is the learner on `app-1` saying their supervisor has vanished.
    // The employer holds that placement and must not see it: a learner who
    // knows their supervisor will read it reports nothing, and then the
    // channel is worth nothing.
    const theirs = await repositories.escalations.forApplication(business(), "app-1");
    expect(theirs).toEqual([]);
    expect(await repositories.escalations.find(business(), "esc-1")).toBeNull();
  });

  it("hides it from the college and the board as well", async () => {
    // Not an oversight that these two are on the same side of the line as the
    // employer. Either may be the party a report is about.
    expect(await repositories.escalations.find(college(), "esc-1")).toBeNull();
    expect(await repositories.escalations.find(board(), "esc-1")).toBeNull();
  });

  it("shows each party their own", async () => {
    const theirs = await repositories.escalations.list(business());
    expect(theirs.map((e) => e.id)).toEqual(["esc-2"]);
  });

  it("leaves the administrator's queue holding only what is still live", async () => {
    const live = await repositories.escalations.live(admin());
    // Kind first, so the four-day-old supervision report outranks the nine-day
    // -old academic one. Within a kind it would be oldest first.
    expect(live.map((e) => e.id)).toEqual(["esc-1", "esc-2"]);
  });

  it("puts safety at the top of the queue ahead of an older report", async () => {
    const raised = await raiseEscalation(student(), {
      applicationId: OWN_APPLICATION,
      kind: "safety",
      summary: "There is no guard on the press I have been asked to run.",
    });
    expect(raised.ok).toBe(true);
    if (!raised.ok) return;

    const live = await repositories.escalations.live(admin());
    // Raised seconds ago and still first, because a safety report outranks a
    // fortnight-old scheduling problem.
    expect(live[0]?.id).toBe(raised.updated.id);
  });
});

describe("what becomes of one", () => {
  it("lets the administrator pick one up", async () => {
    const result = await acknowledgeEscalation(admin(), "esc-1");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.updated.status).toBe("acknowledged");
    expect(result.updated.acknowledgedByUserId).toBe("u-admin");
  });

  it("refuses to resolve one without saying what was done", async () => {
    const result = await resolveEscalation(admin(), "esc-1", "   ");
    expect(result).toMatchObject({ ok: false, code: "conflict" });
  });

  it("carries the resolution into the audit log", async () => {
    // The opposite of the summary on the way in, and deliberately: what was
    // done about a problem is the market's record, what somebody reported is
    // theirs.
    const result = await resolveEscalation(
      admin(),
      "esc-1",
      "Spoke to the plant manager; a new supervisor starts Monday.",
    );
    expect(result.ok).toBe(true);
    const entry = seed.auditEvents.find((e) => e.entityId === "esc-1");
    expect(entry?.reason).toContain("new supervisor");
  });

  it("refuses to let anybody but the administrator resolve one", async () => {
    // Including the person who raised it: withdrawing is theirs, resolving is
    // not, and the two are different events.
    const result = await resolveEscalation(business(), "esc-2", "Sorted it out.");
    expect(result).toMatchObject({ ok: false, code: "forbidden" });
  });

  it("lets the raiser withdraw their own", async () => {
    const result = await withdrawEscalation(business(), "esc-2");
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.updated.status).toBe("withdrawn");
  });

  it("refuses to let one person withdraw another's", async () => {
    const result = await withdrawEscalation(admin(), "esc-2");
    expect(result).toMatchObject({ ok: false, code: "forbidden" });
  });

  it("refuses to reopen one that is closed", async () => {
    const result = await acknowledgeEscalation(admin(), "esc-3");
    expect(result).toMatchObject({ ok: false, code: "conflict" });
  });

  it("does not touch the application's own status", async () => {
    // The point of the record: a placement in trouble is usually still running,
    // and reporting it must not be a transition somebody could refuse.
    const before = await repositories.applications.find(admin(), "app-1");
    await acknowledgeEscalation(admin(), "esc-1");
    const after = await repositories.applications.find(admin(), "app-1");
    expect(after?.status).toBe(before?.status);
    expect(after?.version).toBe(before?.version);
  });
});
