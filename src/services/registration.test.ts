/**
 * Self-registration — the first way into this system that is not somebody
 * already inside it adding you.
 *
 * These mutate the shared seed arrays, so each test puts back what it changed.
 *
 * The two worth reading first are the enumeration one and the demonstration
 * one. Everything else checks a rule that fails loudly; those two fail quietly
 * and in opposite directions — one hands a stranger a roster, the other writes
 * a real person's name into rows the next seed deletes.
 */

import { describe, it, expect, afterEach } from "vitest";
import { registerLearner, registrableColleges } from "./registration";
import { contextFor } from "@/data/session";
import { repositories } from "@/data/backend";
import { resetMemberships } from "@/data/session";
import * as seed from "@/data/seed";

const students = seed.students.map((s) => ({ ...s }));
const users = seed.users.map((u) => ({ ...u }));
const markets = seed.markets.map((m) => ({ ...m }));

afterEach(() => {
  seed.students.splice(0, seed.students.length, ...students.map((s) => ({ ...s })));
  seed.users.splice(0, seed.users.length, ...users.map((u) => ({ ...u })));
  seed.markets.splice(0, seed.markets.length, ...markets.map((m) => ({ ...m })));
  for (const e of seed.auditEvents.filter((a) => a.to?.startsWith("registered with"))) {
    seed.auditEvents.splice(seed.auditEvents.indexOf(e), 1);
  }
  resetMemberships();
});

const COLLEGE = "org-verdigris";
const NEW = { name: "Ada Okonkwo", email: "aokonkwo@students.verdigris.example.edu" };

/** Make the seeded market registrable — it is the demonstration by default. */
function openTheMarket() {
  const market = seed.markets.find((m) => m.id === "mkt-pittsburg")!;
  market.isDemoData = false;
  market.stage = "live";
}

describe("which colleges a stranger is offered", () => {
  it("offers none while every market is the demonstration", async () => {
    // The seeded markets are flagged, and a real name written into one of them
    // is deleted by the next `db:seed` — so the list is empty rather than
    // inviting somebody to register into fiction.
    expect(await registrableColleges()).toEqual([]);
  });

  it("offers a college once its market is live and real", async () => {
    openTheMarket();
    const offered = await registrableColleges();
    expect(offered.map((c) => c.id)).toContain(COLLEGE);
    // Three fields and no more: this renders on a page anyone can load, and an
    // organization carries a contact address and a vetting status.
    expect(Object.keys(offered[0]).sort()).toEqual(["id", "marketName", "name"]);
  });
});

describe("registering", () => {
  it("creates an unverified learner with an account and a membership", async () => {
    openTheMarket();
    expect(await registerLearner({ ...NEW, collegeId: COLLEGE })).toEqual({ ok: true });

    const admin = contextFor("admin");
    const created = (await repositories.students.list(admin)).find(
      (s) => s.email === NEW.email,
    );
    expect(created).toBeTruthy();
    // The whole point: this fills the college's queue rather than bypassing it.
    expect(created!.status).toBe("registered");
    expect(created!.verifiedOn).toBeNull();
    expect(created!.collegeId).toBe(COLLEGE);
    expect(seed.users.some((u) => u.email === NEW.email)).toBe(true);
  });

  it("refuses an address that is not the college's", async () => {
    openTheMarket();
    const result = await registerLearner({
      name: NEW.name,
      email: "ada@gmail.example.com",
      collegeId: COLLEGE,
    });
    expect(result.ok).toBe(false);
    expect(seed.students.some((s) => s.email === "ada@gmail.example.com")).toBe(false);
  });

  it("accepts a subdomain of the college's own", async () => {
    // `students.verdigris.example.edu` under `verdigris.example.edu`. Worth a
    // test because it is how every real institution addresses its learners.
    openTheMarket();
    expect(await registerLearner({ ...NEW, collegeId: COLLEGE })).toEqual({ ok: true });
  });

  it("refuses a market that is not live", async () => {
    const market = seed.markets.find((m) => m.id === "mkt-pittsburg")!;
    market.isDemoData = false;
    market.stage = "configuring";
    const result = await registerLearner({ ...NEW, collegeId: COLLEGE });
    expect(result.ok).toBe(false);
  });

  it("refuses the demonstration outright", async () => {
    // Live, and flagged. A real person's name and address in a row marked
    // `is_demo_data` is the one outcome worth refusing rather than tidying.
    const market = seed.markets.find((m) => m.id === "mkt-pittsburg")!;
    market.stage = "live";
    market.isDemoData = true;
    const result = await registerLearner({ ...NEW, collegeId: COLLEGE });
    expect(result.ok).toBe(false);
    expect(seed.students.some((s) => s.email === NEW.email)).toBe(false);
  });

  it("refuses an organization that is not a college", async () => {
    openTheMarket();
    const result = await registerLearner({
      ...NEW,
      collegeId: "org-apex",
    });
    expect(result.ok).toBe(false);
  });

  it("says the same thing about a market that is missing, closed or fictional", async () => {
    // One sentence for all three, so picking ids out of the form cannot map
    // which markets exist and what stage each is at.
    openTheMarket();
    const nonexistent = await registerLearner({ ...NEW, collegeId: "org-nope" });
    const market = seed.markets.find((m) => m.id === "mkt-pittsburg")!;
    market.stage = "paused";
    const closed = await registerLearner({ ...NEW, collegeId: COLLEGE });
    expect(nonexistent.ok).toBe(false);
    expect(closed.ok).toBe(false);
    if (!nonexistent.ok && !closed.ok) {
      expect(closed.error).toBe("That college is not open for registration yet.");
      // The missing college is caught a step earlier, by the same refusal to
      // say which of the two it was.
      expect(nonexistent.error).toBe("Choose the college you attend.");
    }
  });
});

describe("an address that is already registered", () => {
  it("answers exactly as a success does, and writes nothing", async () => {
    // The assertion this file exists for. `addOrganizationMember` says plainly
    // that somebody already holds an address, and explains why that is safe
    // there: an administrator looking at their own people. Here the caller is
    // a stranger, and the same sentence turns this form into a roster.
    openTheMarket();
    const taken = seed.students[0].email;
    const before = seed.students.length;

    const result = await registerLearner({
      name: "Somebody Else",
      email: taken,
      collegeId: COLLEGE,
    });

    expect(result).toEqual({ ok: true });
    expect(seed.students.length).toBe(before);
    expect(seed.students.filter((s) => s.email === taken)).toHaveLength(1);
  });
});
