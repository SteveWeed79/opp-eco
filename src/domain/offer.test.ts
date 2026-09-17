import { describe, it, expect } from "vitest";
import type { Application, HostOffer } from "./types";
import { redactHostOffer } from "./disclosure";
import {
  HOST_OFFER_ANSWERS,
  HOST_OFFER_RECORDERS,
  canRecordHostOffer,
  hostOfferAnswerLabel,
  hostOfferFor,
  isHire,
  offerAwaitsAnswer,
  offerBlockReason,
  summarizeHostOffers,
} from "./offer";

function application(overrides: Partial<Application> = {}): Application {
  return {
    id: "app-1",
    marketId: "mkt-1",
    postingId: "post-1",
    studentId: "stu-1",
    track: "standard",
    status: "placement_completed",
    furthestStatus: "placement_completed",
    submittedOn: "2026-01-01T00:00:00.000Z",
    statusSince: "2026-05-01T00:00:00.000Z",
    matchScore: { score: 80, algorithmVersion: "v1", factors: [] },
    version: 1,
    ...overrides,
  };
}

function offer(overrides: Partial<HostOffer> = {}): HostOffer {
  return {
    id: "off-1",
    marketId: "mkt-1",
    applicationId: "app-1",
    businessId: "biz-1",
    studentId: "stu-1",
    answer: "accepted",
    recordedByUserId: "u-biz",
    recordedOn: "2026-05-10T00:00:00.000Z",
    source: "business",
    ...overrides,
  };
}

describe("the offer vocabulary", () => {
  it("orders the strongest result first", () => {
    expect(HOST_OFFER_ANSWERS[0].value).toBe("accepted");
  });

  it("keeps a declined offer distinct from no offer at all", () => {
    // The whole reason this is three answers rather than a boolean. An area
    // losing people who had a local offer in hand has a different problem from
    // one with no offers to make, and no later analysis can separate them if
    // they were written to the same value.
    const values = HOST_OFFER_ANSWERS.map((a) => a.value);
    expect(values).toContain("declined");
    expect(values).toContain("none");
  });

  it("labels every answer", () => {
    for (const { value, label } of HOST_OFFER_ANSWERS) {
      expect(hostOfferAnswerLabel(value)).toBe(label);
    }
  });

  it("counts only an accepted offer as a hire", () => {
    expect(isHire("accepted")).toBe(true);
    expect(isHire("declined")).toBe(false);
    expect(isHire("none")).toBe(false);
  });
});

describe("who may answer", () => {
  it("lets the employer answer for itself", () => {
    expect(canRecordHostOffer("business")).toBe(true);
  });

  it("lets an administrator record what an employer told them", () => {
    // The chase queue is only worth having if the person working it can write
    // down what they hear.
    expect(canRecordHostOffer("admin")).toBe(true);
  });

  it("refuses the college, which does not observe an employer's headcount", () => {
    // It can tell you a learner is working somewhere — that is an outcome.
    // What this employer decided about its own hiring is not something it sees.
    expect(canRecordHostOffer("college")).toBe(false);
  });

  it("refuses the learner and the board", () => {
    expect(canRecordHostOffer("student")).toBe(false);
    expect(canRecordHostOffer("board")).toBe(false);
  });

  it("names exactly two recorders", () => {
    expect(HOST_OFFER_RECORDERS).toEqual(["business", "admin"]);
  });
});

describe("when an answer is owed", () => {
  it("asks once the placement has finished", () => {
    expect(offerAwaitsAnswer(application(), [])).toBe(true);
  });

  it("never asks about a placement that is still running", () => {
    expect(offerAwaitsAnswer(application({ status: "placement_active" }), [])).toBe(false);
  });

  it("asks about one that ended early", () => {
    // "We made no offer, they left in week three" is a real answer, and the
    // note is where the value is.
    const ended = application({
      status: "terminated_early",
      furthestStatus: "placement_active",
    });
    expect(offerAwaitsAnswer(ended, [])).toBe(true);
  });

  it("never asks about an application that never reached a placement", () => {
    const rejected = application({ status: "rejected", furthestStatus: "under_review" });
    expect(offerAwaitsAnswer(rejected, [])).toBe(false);
  });

  it("stops asking once the employer has answered", () => {
    expect(offerAwaitsAnswer(application(), [offer()])).toBe(false);
  });

  it("stops asking on any answer, including no offer", () => {
    // "No offer" is an answer. The queue exists to find placements nobody has
    // spoken about, not placements that did not convert.
    expect(offerAwaitsAnswer(application(), [offer({ answer: "none" })])).toBe(false);
  });

  it("is not satisfied by an answer about a different placement", () => {
    expect(
      offerAwaitsAnswer(application(), [offer({ applicationId: "app-2" })]),
    ).toBe(true);
  });

  it("says why it cannot be asked yet", () => {
    expect(offerBlockReason(application({ status: "placement_active" }))).toMatch(
      /has not finished/,
    );
    expect(offerBlockReason(application())).toBeNull();
  });

  it("finds the answer for a placement, and null when there is none", () => {
    expect(hostOfferFor(application(), [offer()])?.id).toBe("off-1");
    expect(hostOfferFor(application(), [])).toBeNull();
  });
});

describe("summarising what hosts did", () => {
  it("counts each answer", () => {
    const apps = [
      application({ id: "app-1", studentId: "stu-1" }),
      application({ id: "app-2", studentId: "stu-2" }),
      application({ id: "app-3", studentId: "stu-3" }),
    ];
    const offers = [
      offer({ id: "off-1", applicationId: "app-1", answer: "accepted" }),
      offer({ id: "off-2", applicationId: "app-2", answer: "declined" }),
      offer({ id: "off-3", applicationId: "app-3", answer: "none" }),
    ];
    const summary = summarizeHostOffers(apps, offers);
    expect(summary.accepted).toBe(1);
    expect(summary.declined).toBe(1);
    expect(summary.none).toBe(1);
    expect(summary.answered).toBe(3);
    expect(summary.unanswered).toBe(0);
  });

  it("never counts an unanswered placement as a refusal to hire", () => {
    // The assertion this whole record shape exists for. One employer said no,
    // one never replied. A rate of 0 over 2 would be reporting an admin backlog
    // as employers who would not hire.
    const apps = [
      application({ id: "app-1" }),
      application({ id: "app-2" }),
    ];
    const summary = summarizeHostOffers(apps, [
      offer({ applicationId: "app-1", answer: "none" }),
    ]);
    expect(summary.answered).toBe(1);
    expect(summary.unanswered).toBe(1);
    expect(summary.none).toBe(1);
    expect(summary.hireRate).toBe(0);
  });

  it("reports no rate at all when nobody has answered", () => {
    // Zero would report an unworked queue as a bad result, which is the same
    // rule the outcome summary follows.
    const summary = summarizeHostOffers([application()], []);
    expect(summary.hireRate).toBeNull();
    expect(summary.offerRate).toBeNull();
    expect(summary.unanswered).toBe(1);
  });

  it("separates the offer rate from the hire rate", () => {
    // Two towns can have the same hire rate for opposite reasons. Here every
    // employer made an offer and half were turned down: the work is there, and
    // something else is winning. An offer rate of 0.5 with the same hire rate
    // would be a different town with a different problem.
    const apps = [application({ id: "app-1" }), application({ id: "app-2" })];
    const summary = summarizeHostOffers(apps, [
      offer({ id: "off-1", applicationId: "app-1", answer: "accepted" }),
      offer({ id: "off-2", applicationId: "app-2", answer: "declined" }),
    ]);
    expect(summary.hireRate).toBe(0.5);
    expect(summary.offerRate).toBe(1);
  });

  it("ignores placements that have not finished", () => {
    const apps = [
      application({ id: "app-1" }),
      application({ id: "app-2", status: "placement_active" }),
    ];
    const summary = summarizeHostOffers(apps, []);
    expect(summary.unanswered).toBe(1);
  });
});

describe("what a note is shown to", () => {
  it("strips the employer's note", () => {
    // The most useful sentence in the record for a town review, and the most
    // damaging one for the learner it is about.
    const stripped = redactHostOffer(offer({ answer: "none", note: "No headcount this year." }));
    expect(stripped.note).toBeUndefined();
  });

  it("keeps the answer, which is not a secret from anybody", () => {
    // A learner knows perfectly well whether they were offered a job. Hiding
    // the answer from the person it happened to would be theatre.
    const stripped = redactHostOffer(offer({ answer: "declined", note: "They took a job in Joplin." }));
    expect(stripped.answer).toBe("declined");
    expect(stripped.recordedOn).toBe("2026-05-10T00:00:00.000Z");
  });
});
