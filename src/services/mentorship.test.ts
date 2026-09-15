/**
 * Introductions: who may make one, and what stops one.
 *
 * The college's mentor list was a list rather than a queue because the pairing
 * happened off-platform, which meant `capacity` was a number nobody could
 * check and a mentorship counted toward nothing. These are the rules that
 * replaced that — and most of them are refusals, because an introduction puts
 * an adult in front of a student with no supervisor, no timesheet and no board
 * interview in between.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { introduceStudentToMentor } from "./creation";
import { recordMentorshipOutcome } from "./lifecycle";
import { contextFor } from "@/data/session";
import * as seed from "@/data/seed";
import { placesLeft } from "@/domain/mentorship";
import type { MentorshipOffer, MentorshipPairing } from "@/domain/types";

const college = contextFor("college");
const admin = contextFor("admin");
const business = contextFor("business");
const student = contextFor("student");
const board = contextFor("board");

/** An open offer with room, restored between cases. */
const OFFER = "men-apex-controls";
/** Verified, and not already with that mentor. */
const VERIFIED = "stu-alex";

let offers: MentorshipOffer[];
let pairings: MentorshipPairing[];

beforeEach(() => {
  offers = seed.mentorshipOffers.map((o) => ({ ...o }));
  pairings = seed.mentorshipPairings.map((p) => ({ ...p }));
});

afterEach(() => {
  seed.mentorshipOffers.splice(0, seed.mentorshipOffers.length, ...offers);
  seed.mentorshipPairings.splice(0, seed.mentorshipPairings.length, ...pairings);
});

describe("who may introduce", () => {
  it("lets the college introduce one of its students", async () => {
    const result = await introduceStudentToMentor(college, OFFER, VERIFIED);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.created.introducedByUserId).toBe(college.user.id);
      expect(result.created.status).toBe("introduced");
    }
  });

  it("lets an administrator introduce, which is not an override", async () => {
    // A market whose college has not acted is what an operator exists to
    // unstick. Every check the college's path runs, this one runs.
    const result = await introduceStudentToMentor(admin, OFFER, VERIFIED);
    expect(result.ok).toBe(true);
  });

  it.each([
    ["an employer", business],
    ["a student", student],
    ["the board", board],
  ])("refuses %s", async (_label, actor) => {
    const result = await introduceStudentToMentor(actor, OFFER, VERIFIED);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("forbidden");
  });
});

describe("what stops an introduction", () => {
  it("refuses a student the college has not verified", async () => {
    // The only check standing between an adult and a student on the one form
    // with no supervisor, no timesheet and no board interview.
    const unverified = seed.students.find((s) => s.status !== "verified")!;
    const result = await introduceStudentToMentor(college, OFFER, unverified.id);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/verify/i);
  });

  it("refuses a mentor who has paused, and says which", async () => {
    const paused = seed.mentorshipOffers.find((o) => o.id === OFFER)!;
    paused.status = "paused";
    const result = await introduceStudentToMentor(college, OFFER, VERIFIED);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/paused/i);
  });

  it("refuses the same student twice while the first is live", async () => {
    const first = await introduceStudentToMentor(college, OFFER, VERIFIED);
    expect(first.ok).toBe(true);

    const second = await introduceStudentToMentor(college, OFFER, VERIFIED);
    expect(second.ok).toBe(false);
    if (!second.ok) expect(second.code).toBe("duplicate");
  });

  it("refuses once the mentor's declared places are full", async () => {
    const offer = seed.mentorshipOffers.find((o) => o.id === OFFER)!;
    const candidates = seed.students
      .filter((s) => s.status === "verified" && s.marketId === offer.marketId)
      .map((s) => s.id);

    let made = 0;
    for (const id of candidates) {
      const result = await introduceStudentToMentor(college, OFFER, id);
      if (result.ok) made += 1;
      else if (result.code === "forbidden") break;
    }

    // Capacity, not the size of the roster, is what stopped it.
    expect(made).toBeLessThan(candidates.length);
    expect(placesLeft(offer, seed.mentorshipPairings)).toBe(0);
  });
});

describe("closing one", () => {
  it("gives the place back and records what happened", async () => {
    const offer = seed.mentorshipOffers.find((o) => o.id === OFFER)!;
    const before = placesLeft(offer, seed.mentorshipPairings);

    const made = await introduceStudentToMentor(college, OFFER, VERIFIED);
    expect(made.ok).toBe(true);
    if (!made.ok) return;
    expect(placesLeft(offer, seed.mentorshipPairings)).toBe(before - 1);

    const closed = await recordMentorshipOutcome(
      business,
      made.created.id,
      "met",
      "Hour on controls engineering; she is applying for the summer posting.",
    );
    expect(closed.ok).toBe(true);
    // A finished mentorship must not keep occupying a place for a year.
    expect(placesLeft(offer, seed.mentorshipPairings)).toBe(before);
  });

  it("refuses a closing note that is only whitespace", async () => {
    const made = await introduceStudentToMentor(college, OFFER, VERIFIED);
    if (!made.ok) throw new Error("setup failed");

    const closed = await recordMentorshipOutcome(business, made.created.id, "met", "   ");
    expect(closed.ok).toBe(false);
    if (!closed.ok) expect(closed.code).toBe("invalid");
  });

  it("refuses an employer an introduction made to someone else", async () => {
    const foreign = seed.mentorshipPairings.find(
      (p) => p.businessId !== business.membership.organizationId,
    )!;
    const closed = await recordMentorshipOutcome(
      business,
      foreign.id,
      "met",
      "Not mine to close.",
    );
    expect(closed.ok).toBe(false);
  });
});
