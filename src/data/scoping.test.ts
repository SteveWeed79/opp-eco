/**
 * Access-control tests for the repository layer.
 *
 * This layer had no coverage at all until the vitest alias config existed,
 * which is how a tautological ownership check and three unscoped accessors
 * survived. Every finding below is pinned by a test.
 */

import { describe, it, expect } from "vitest";
import { repositories } from "./memory";
import { contextFor } from "./session";
import * as seed from "./seed";

const business = contextFor("business"); // Apex Robotics
const college = contextFor("college");
const board = contextFor("board");
const admin = contextFor("admin");
const student = contextFor("student");

const APEX = "org-apex";
const FOREIGN_POSTING = "post-cherokee-mfg"; // owned by Cherokee Valley
const FOREIGN_APPLICATION = "app-2"; // against that posting

describe("market isolation", () => {
  it("shows admin every market", async () => {
    expect((await repositories.markets.list(admin)).length).toBe(seed.markets.length);
  });

  it("shows a college only its own market", async () => {
    const markets = await repositories.markets.list(college);
    expect(markets).toHaveLength(1);
    expect(markets[0].id).toBe(college.membership.marketId);
  });

  it("refuses a college a market it does not belong to", async () => {
    expect(await repositories.markets.find(college, "mkt-emporia")).toBeNull();
  });

  it("keeps every student read inside the actor's market", async () => {
    const outside = (await repositories.students
      .list(college))
      .filter((s) => s.marketId !== college.membership.marketId);
    expect(outside).toHaveLength(0);
  });
});

describe("business ownership", () => {
  it("lists only its own postings", async () => {
    const foreign = (await repositories.postings
      .list(business))
      .filter((p) => p.businessId !== APEX);
    expect(foreign).toHaveLength(0);
  });

  it("cannot fetch a competitor's posting by id", async () => {
    expect(await repositories.postings.find(business, FOREIGN_POSTING)).toBeNull();
  });

  it("still browses published postings across the market", async () => {
    // The shopfront is shared; ownership narrows management, not discovery.
    const published = await repositories.postings.published(business);
    expect(published.some((p) => p.businessId !== APEX)).toBe(true);
  });

  it("lists only applications against its own postings", async () => {
    const own = new Set(
      seed.postings.filter((p) => p.businessId === APEX).map((p) => p.id),
    );
    const leaked = (await repositories.applications
      .list(business))
      .filter((a) => !own.has(a.postingId));
    expect(leaked).toHaveLength(0);
  });

  // The three accessors below all used to stop at market scope while `list`
  // narrowed by ownership, so a competitor's pipeline was one id away.
  it("cannot fetch a competitor's application by id", async () => {
    expect(await repositories.applications.find(business, FOREIGN_APPLICATION)).toBeNull();
  });

  it("cannot read a competitor's pipeline via forPosting", async () => {
    expect(await repositories.applications.forPosting(business, FOREIGN_POSTING)).toHaveLength(0);
  });

  it("cannot read a student's applications to other businesses", async () => {
    const own = new Set(
      seed.postings.filter((p) => p.businessId === APEX).map((p) => p.id),
    );
    const leaked = (await repositories.applications
      .forStudent(business, "stu-omar"))
      .filter((a) => !own.has(a.postingId));
    expect(leaked).toHaveLength(0);
  });
});

describe("mentorship offers", () => {
  const FOREIGN_OFFER = "men-cherokee-shadow"; // Cherokee Valley's

  it("lists only its own offers to an employer", async () => {
    const foreign = (await repositories.mentorshipOffers
      .list(business))
      .filter((o) => o.businessId !== APEX);
    expect(foreign).toHaveLength(0);
  });

  it("cannot fetch a competitor's offer by id", async () => {
    // Same narrowing as postings, applied to every accessor rather than only
    // to `list` — that omission is the bug this file exists to pin.
    expect(await repositories.mentorshipOffers.find(business, FOREIGN_OFFER)).toBeNull();
  });

  it("still browses the market's mentor list", async () => {
    // The mentor list is a shopfront like published postings. An offer only
    // its author can see is an offer made to nobody.
    const open = await repositories.mentorshipOffers.openInMarket(business);
    expect(open.some((o) => o.businessId !== APEX)).toBe(true);
  });

  it("shows students the open offers and nothing else", async () => {
    const open = await repositories.mentorshipOffers.openInMarket(student);

    expect(open.length).toBeGreaterThan(0);
    // Paused and withdrawn are absent by definition: an employer who paused
    // and still appeared here would field introductions they cannot take.
    expect(open.every((o) => o.status === "open")).toBe(true);
    expect(open.some((o) => o.id === "men-apex-shadow")).toBe(false);
    expect(open.some((o) => o.id === "men-apex-retired")).toBe(false);
  });

  it("keeps the mentor list inside the actor's market", async () => {
    const outside = (await repositories.mentorshipOffers
      .openInMarket(college))
      .filter((o) => o.marketId !== college.membership.marketId);
    expect(outside).toHaveLength(0);
  });
});

describe("college scope", () => {
  it("sees every posting in its market, since it operates the market", async () => {
    const all = seed.postings.filter((p) => p.marketId === college.membership.marketId);
    expect(await repositories.postings.list(college)).toHaveLength(all.length);
  });

  it("sees applications across its market", async () => {
    expect((await repositories.applications.list(college)).length).toBeGreaterThan(0);
  });
});

describe("PII disclosure", () => {
  async function applicationAt(status: string) {
    const found = (await repositories.applications.list(business)).find(
      (a) => a.status === status,
    );
    if (!found) throw new Error(`No seeded application at status "${status}"`);
    return found;
  }

  it("withholds a candidate's surname and email before clearance", async () => {
    const application = await applicationAt("shortlisted");
    const student = (await repositories.students.forApplication(business, application))!;
    const full = seed.students.find((s) => s.id === application.studentId)!;

    expect(student.name).not.toBe(full.name);
    expect(student.name).toMatch(/^\w+ \w\.$/);
    // Redacted, not merely hidden — the value is gone from the payload.
    expect(student.email).toBe("");
  });

  it("releases full details once the placement is real", async () => {
    const application = await applicationAt("placement_active");
    const student = (await repositories.students.forApplication(business, application))!;
    const full = seed.students.find((s) => s.id === application.studentId)!;
    expect(student.name).toBe(full.name);
    expect(student.email).toBe(full.email);
  });

  it("keeps a completed intern's name visible rather than re-masking it", async () => {
    const application = (await repositories.applications.list(business)).find(
      (a) => a.status === "credit_granted" || a.status === "credit_pending",
    );
    if (!application) return;
    const student = (await repositories.students.forApplication(business, application))!;
    const full = seed.students.find((s) => s.id === application.studentId)!;
    expect(student.name).toBe(full.name);
  });

  it("does not redact for the college, which owns the relationship", async () => {
    const application = (await repositories.applications.list(college))[0];
    const student = (await repositories.students.forApplication(college, application))!;
    const full = seed.students.find((s) => s.id === application.studentId)!;
    expect(student.name).toBe(full.name);
  });
});

describe("session wiring", () => {
  it("resolves every demo account's user", async () => {
    for (const role of ["admin", "student", "business", "college", "board"] as const) {
      const actor = contextFor(role);
      expect(await repositories.users.find(actor.user.id)).not.toBeNull();
    }
  });

  it("resolves the signed-in student from their user id", async () => {
    // Deriving `u-${student.id}` produced `u-stu-omar`, matching nothing.
    expect(seed.studentForUser(student.user.id)?.id).toBe("stu-omar");
  });

  it("gives every student record a user that exists", async () => {
    for (const s of seed.students) {
      expect(await repositories.users.find(s.userId), s.name).not.toBeNull();
    }
  });
});

describe("interview slots stay in the future", () => {
  it("offers no slot that has already passed", async () => {
    const now = Date.now();
    for (const slot of await repositories.interviewSlots.list(board)) {
      expect(new Date(slot.startsAt).getTime()).toBeGreaterThan(now);
    }
  });

  it("recomputes against real time rather than a fixed anchor", async () => {
    const later = new Date(Date.now() + 30 * 86_400_000);
    const slots = seed.interviewSlotsAt(later);
    expect(new Date(slots[0].startsAt).getTime()).toBeGreaterThan(later.getTime());
  });
});
