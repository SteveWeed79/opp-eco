import { describe, it, expect } from "vitest";
import type { ActorContext, ActorRole, MentorshipOffer } from "./types";
import {
  MENTORSHIP_FORMATS,
  MENTORSHIP_TRANSITIONS,
  isOfferedToStudents,
  mentorshipFormatLabel,
  mentorshipMachine,
} from "./mentorship";

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

function offer(overrides: Partial<MentorshipOffer> = {}): MentorshipOffer {
  return {
    id: "men-1",
    marketId: MARKET,
    businessId: "org-1",
    format: "portfolio_review",
    mentorName: "Dana Reyes",
    mentorRole: "Director of Engineering",
    topics: ["Robotics"],
    description: "An hour on a student's portfolio.",
    capacity: 2,
    status: "open",
    createdOn: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

describe("the format vocabulary", () => {
  it("orders the lightest commitment first", () => {
    // An employer who reads "ongoing one-to-one" as the default offer declines
    // the whole card, so the cheapest thing they can say yes to is on top and
    // the largest is last.
    expect(MENTORSHIP_FORMATS[0].value).toBe("portfolio_review");
    expect(MENTORSHIP_FORMATS[MENTORSHIP_FORMATS.length - 1].value).toBe("one_to_one");
  });

  it("states the size of every commitment", () => {
    // The point of naming formats instead of taking free text is that an
    // employer can tell what they are agreeing to. A format with no stated
    // size is back to "we'd be happy to help".
    for (const format of MENTORSHIP_FORMATS) {
      expect(format.meta.trim().length).toBeGreaterThan(0);
      expect(format.description.trim().length).toBeGreaterThan(0);
    }
  });

  it("labels every format a stored offer can hold", () => {
    for (const format of MENTORSHIP_FORMATS) {
      expect(mentorshipFormatLabel(format.value)).toBe(format.label);
    }
  });
});

describe("who students can see", () => {
  it("shows an open offer", () => {
    expect(isOfferedToStudents(offer())).toBe(true);
  });

  it("hides a paused one", () => {
    // An employer who paused and still appeared on the mentor list would be
    // fielding introductions they said they could not take.
    expect(isOfferedToStudents(offer({ status: "paused" }))).toBe(false);
  });

  it("hides a withdrawn one", () => {
    expect(isOfferedToStudents(offer({ status: "withdrawn" }))).toBe(false);
  });
});

describe("the offer's lifecycle", () => {
  it("lets the employer pause and reopen", () => {
    const business = actor("business");

    expect(mentorshipMachine.attempt(business, { offer: offer() }, "paused").ok).toBe(
      true,
    );
    expect(
      mentorshipMachine.attempt(business, { offer: offer({ status: "paused" }) }, "open")
        .ok,
    ).toBe(true);
  });

  it("has a way back from paused, so a busy quarter is not a withdrawal", () => {
    // The whole reason `paused` exists. If the only move off it were
    // `withdrawn`, an employer stopping for one term would leave for good.
    const back = MENTORSHIP_TRANSITIONS.filter((t) => t.from === "paused");
    expect(back.map((t) => t.to).sort()).toEqual(["open", "withdrawn"]);
  });

  it("has no move off withdrawn", () => {
    // Terminal, which is what lets the employer's own portal drop the row
    // rather than render a tombstone with no buttons on it.
    expect(MENTORSHIP_TRANSITIONS.filter((t) => t.from === "withdrawn")).toEqual([]);
  });

  it("refuses another employer's offer", () => {
    const other = actor("business", { organizationId: "org-2" });
    const verdict = mentorshipMachine.attempt(other, { offer: offer() }, "paused");

    expect(verdict.ok).toBe(false);
    expect(verdict.error).toContain("another organization");
  });

  it("refuses an actor outside the market", () => {
    const elsewhere = actor("business", { marketId: "mkt-2" });
    expect(
      mentorshipMachine.attempt(elsewhere, { offer: offer() }, "paused").ok,
    ).toBe(false);
  });

  it("refuses the college, which does not own this", () => {
    // Deliberate, and the difference from a posting: the college reviews
    // postings because review is what makes them credit-bearing. A mentorship
    // carries no credit, so there is nothing for the college to underwrite and
    // no reason for it to be able to take an employer's offer down.
    const verdict = mentorshipMachine.attempt(actor("college"), { offer: offer() }, "paused");

    expect(verdict.ok).toBe(false);
    expect(verdict.error).toContain("may not perform");
  });

  it("offers a student nothing at all", () => {
    expect(mentorshipMachine.available(actor("student"), { offer: offer() })).toEqual([]);
  });

  it("lets an administrator unstick one, and asks why", () => {
    const admin = actor("admin", { organizationId: null, marketId: null });
    const withdrawn = { offer: offer({ status: "paused" }) };

    // Admin holds no `business` role, so this is an override — and an override
    // with no explanation is indistinguishable in the log from the rule not
    // existing.
    expect(mentorshipMachine.attempt(admin, withdrawn, "withdrawn").ok).toBe(false);

    const withReason = mentorshipMachine.attempt(
      admin,
      withdrawn,
      "withdrawn",
      "Named mentor no longer works there",
    );
    expect(withReason.ok).toBe(true);
    expect(withReason.viaOverride).toBe(true);
  });
});
