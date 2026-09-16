/**
 * The host-answer write path.
 *
 * Writes to the shared seed arrays like `outcome.test.ts` does, so every test
 * records what it added and takes it out again — otherwise the counts the
 * reporting suites assert on drift depending on which file ran first. An
 * accepted answer writes two records, so both have to be cleaned up.
 */

import { describe, it, expect, afterEach } from "vitest";
import { recordHostOffer } from "./creation";
import { contextFor } from "@/data/session";
import { hasExited } from "@/domain/outcome";
import * as seed from "@/data/seed";

const addedOffers: string[] = [];
const addedOutcomes: string[] = [];

afterEach(() => {
  for (const id of addedOffers) {
    const i = seed.hostOffers.findIndex((o) => o.id === id);
    if (i !== -1) seed.hostOffers.splice(i, 1);
  }
  for (const id of addedOutcomes) {
    const i = seed.outcomes.findIndex((o) => o.id === id);
    if (i !== -1) seed.outcomes.splice(i, 1);
  }
  for (const id of [...addedOffers, ...addedOutcomes]) {
    const j = seed.auditEvents.findIndex((e) => e.entityId === id);
    if (j !== -1) seed.auditEvents.splice(j, 1);
  }
  addedOffers.length = 0;
  addedOutcomes.length = 0;
});

const business = () => contextFor("business");
const admin = () => contextFor("admin");
const college = () => contextFor("college");
const student = () => contextFor("student");
const board = () => contextFor("board");

/**
 * The outcomes the fixtures ship with, so anything else in the array is
 * something a test put there.
 *
 * Identifying them by id rather than by shape: a generated id is
 * `out-<base36 of the clock>`, and matching on a prefix of that would work
 * until the clock rolled into a different first digit.
 */
const SEEDED_OUTCOME_IDS = new Set(seed.outcomes.map((o) => o.id));

/** Remember what a call created so `afterEach` can undo it. */
function track(result: Awaited<ReturnType<typeof recordHostOffer>>) {
  if (result.ok) {
    addedOffers.push(result.created.id);
    for (const outcome of seed.outcomes) {
      if (!SEEDED_OUTCOME_IDS.has(outcome.id) && !addedOutcomes.includes(outcome.id)) {
        addedOutcomes.push(outcome.id);
      }
    }
  }
  return result;
}

/**
 * The outcome this call wrote, as opposed to one that was already there.
 *
 * The demo employer's one unanswered placement already carries a college
 * follow-up — the college recorded that the learner is at a hospital, and the
 * employer is now saying it made her an offer. That contradiction is a real
 * situation rather than a fixture mistake, and the model's answer is that the
 * most recent observation wins; what it means here is that "the outcome for
 * this application" is ambiguous and the test has to say which one it means.
 */
function writtenOutcome(applicationId: string) {
  return seed.outcomes
    .filter((o) => o.applicationId === applicationId && !SEEDED_OUTCOME_IDS.has(o.id))
    .at(-1);
}

/**
 * A finished placement hosted by the acting employer with no answer yet.
 *
 * Found rather than hard-coded, so a fixture edit does not quietly turn these
 * into tests of a placement that no longer qualifies.
 */
function unansweredOwnPlacement() {
  const org = business().membership.organizationId;
  const own = new Set(
    seed.postings.filter((p) => p.businessId === org).map((p) => p.id),
  );
  const answered = new Set(seed.hostOffers.map((o) => o.applicationId));
  const application = seed.applications.find(
    (a) =>
      own.has(a.postingId) &&
      !answered.has(a.id) &&
      (a.status === "placement_completed" ||
        a.status === "credit_granted" ||
        a.status === "credit_pending"),
  );
  if (!application) throw new Error("no unanswered placement of this employer's in the seed");
  return application;
}

/**
 * Finished placements with no answer, whoever hosted them — the administrator's
 * queue, which is what an admin-acting test is reaching into.
 *
 * Several are needed by the cases that record more than one answer in a single
 * test, and the demo employer deliberately has exactly one of its own.
 */
function unansweredPlacements() {
  const answered = new Set(seed.hostOffers.map((o) => o.applicationId));
  return seed.applications.filter((a) => !answered.has(a.id) && hasExited(a));
}

describe("who may answer", () => {
  it("lets the host employer answer about its own placement", async () => {
    const application = unansweredOwnPlacement();
    const result = track(
      await recordHostOffer(business(), { applicationId: application.id, answer: "none" }),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.created.answer).toBe("none");
    expect(result.created.source).toBe("business");
  });

  it("refuses the college, the learner and the board", async () => {
    const application = unansweredOwnPlacement();
    for (const actor of [college(), student(), board()]) {
      const result = await recordHostOffer(actor, {
        applicationId: application.id,
        answer: "accepted",
      });
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.code).toBe("forbidden");
    }
  });

  it("never takes the source from the caller", async () => {
    // An administrator transcribing a phone call is recorded as an
    // administrator, not as the employer. A report that could not tell the two
    // apart could not tell a working process from a hand-worked one.
    const application = unansweredOwnPlacement();
    const result = track(
      await recordHostOffer(admin(), { applicationId: application.id, answer: "declined" }),
    );
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.created.source).toBe("admin");
  });
});

describe("what it refuses", () => {
  it("refuses a placement that has not finished", async () => {
    const running = seed.applications.find((a) => a.status === "placement_active");
    if (!running) throw new Error("no running placement in the seed");
    const result = await recordHostOffer(admin(), {
      applicationId: running.id,
      answer: "accepted",
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/has not finished/);
  });

  it("refuses a second answer for the same placement", async () => {
    // One answer per placement. An employer changing its mind is an edit, and
    // a second row would make the conversion figure depend on how many times
    // somebody was asked.
    const answered = seed.hostOffers[0];
    const result = await recordHostOffer(admin(), {
      applicationId: answered.applicationId,
      answer: "accepted",
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("duplicate");
  });

  it("refuses a placement hosted by a different employer", async () => {
    // The scoped read makes this unreachable; the assertion is that it stays
    // unreachable. Filing a hiring decision in another company's name is the
    // failure being prevented.
    const org = business().membership.organizationId;
    const others = new Set(
      seed.postings.filter((p) => p.businessId !== org).map((p) => p.id),
    );
    const answered = new Set(seed.hostOffers.map((o) => o.applicationId));
    const foreign = seed.applications.find(
      (a) => others.has(a.postingId) && !answered.has(a.id),
    );
    if (!foreign) throw new Error("no other employer's placement in the seed");

    const result = await recordHostOffer(business(), {
      applicationId: foreign.id,
      answer: "accepted",
    });
    expect(result.ok).toBe(false);
  });

  it("refuses a placement that does not exist", async () => {
    const result = await recordHostOffer(admin(), {
      applicationId: "app-nope",
      answer: "none",
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("not_found");
  });
});

describe("what an accepted offer writes", () => {
  it("records the hire as an outcome in the same breath", async () => {
    // The reason this write is worth having. "Did you keep them?" is the
    // strongest result the programme produces, and an employer answering it
    // should not leave a college to record the same fact again a month later.
    const application = unansweredOwnPlacement();
    const before = seed.outcomes.length;
    const result = track(
      await recordHostOffer(business(), {
        applicationId: application.id,
        answer: "accepted",
      }),
    );
    expect(result.ok).toBe(true);
    expect(seed.outcomes.length).toBe(before + 1);

    const written = writtenOutcome(application.id);
    expect(written?.kind).toBe("employed");
    expect(written?.employedByHost).toBe(true);
    expect(written?.source).toBe("business");
  });

  it("takes the county from the employer, never from a claim about the learner", async () => {
    // The employer has no standing to say where a learner it did *not* hire
    // went. Where it did hire them, the county is a fact about the employer.
    const application = unansweredOwnPlacement();
    const posting = seed.postings.find((p) => p.id === application.postingId);
    const organization = seed.organizations.find((o) => o.id === posting?.businessId);

    track(
      await recordHostOffer(business(), {
        applicationId: application.id,
        answer: "accepted",
      }),
    );
    const written = writtenOutcome(application.id);
    expect(written?.employmentCounty).toBe(organization?.county ?? null);
  });

  it("writes no outcome for a declined offer or no offer", async () => {
    // Neither says anything about where the learner went, and inventing an
    // outcome from "we did not hire them" would be scoring a learner as
    // unemployed on the strength of one employer's headcount.
    //
    // Two answers, so two placements: recorded as the administrator, whose
    // queue reaches every employer's.
    const queue = unansweredPlacements();
    expect(queue.length).toBeGreaterThanOrEqual(2);

    for (const [index, answer] of (["declined", "none"] as const).entries()) {
      const before = seed.outcomes.length;
      const result = track(
        await recordHostOffer(admin(), {
          applicationId: queue[index].id,
          answer,
        }),
      );
      expect(result.ok).toBe(true);
      expect(seed.outcomes.length).toBe(before);
    }
  });
});

describe("what it records about itself", () => {
  it("audits the answer", async () => {
    const application = unansweredOwnPlacement();
    const result = track(
      await recordHostOffer(business(), {
        applicationId: application.id,
        answer: "declined",
        note: "  They took something in Joplin.  ",
      }),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const event = seed.auditEvents.find((e) => e.entityId === result.created.id);
    expect(event?.entityType).toBe("host_offer");
    expect(event?.to).toBe("declined");
    expect(event?.actorUserId).toBe(business().user.id);
  });

  it("trims the note, and keeps an empty one out of the record", async () => {
    const application = unansweredOwnPlacement();
    const result = track(
      await recordHostOffer(business(), {
        applicationId: application.id,
        answer: "none",
        note: "   ",
      }),
    );
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.created.note).toBeUndefined();
  });
});
