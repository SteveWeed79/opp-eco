import { describe, it, expect, afterEach } from "vitest";
import { updateProfile, MAX_TAGS, MAX_HOURS_PER_WEEK } from "./profile";
import { contextFor } from "@/data/session";
import * as seed from "@/data/seed";

/**
 * Editing your own profile.
 *
 * The interesting assertions are about what this refuses to change. The fields
 * a learner owns are their own claims about themselves; the fields they do not
 * own are somebody else's determination about them, and the difference is what
 * makes a registrar's verification mean anything.
 */

const before = seed.students.map((s) => ({ ...s }));

afterEach(() => {
  seed.students.splice(0, seed.students.length, ...before.map((s) => ({ ...s })));
  for (let i = seed.auditEvents.length - 1; i >= 0; i--) {
    if (seed.auditEvents[i].to === "profile_updated") seed.auditEvents.splice(i, 1);
  }
});

const student = () => contextFor("student");

const edit = (overrides: Partial<Parameters<typeof updateProfile>[1]> = {}) => ({
  programOfStudy: "Industrial Maintenance",
  classStanding: "Junior",
  expectedGraduation: "May 2027",
  skills: ["Welding", "Blueprint reading"],
  interests: ["Robotics"],
  availableHoursPerWeek: 15,
  ...overrides,
});

describe("who may edit", () => {
  it("is the learner themselves", async () => {
    const result = await updateProfile(student(), edit());
    expect(result.ok).toBe(true);
  });

  it.each(["college", "admin", "board", "business"] as const)(
    "is not the %s",
    async (role) => {
      // Not even the college that verified them. Correcting a programme of
      // study on somebody's behalf is a different operation with a different
      // audit trail, and it does not exist yet.
      const result = await updateProfile(contextFor(role), edit());
      expect(result.ok).toBe(false);
    },
  );
});

describe("what it will not touch", () => {
  it("leaves the name, email and college exactly as the registrar left them", async () => {
    // The whole boundary. The email is also the credential under real sign-on,
    // so self-service editing of it is an account-takeover primitive rather
    // than a profile feature.
    const result = await updateProfile(student(), edit());
    if (!result.ok) throw new Error(result.error);

    const original = before.find((s) => s.id === result.updated.id)!;
    expect(result.updated.name).toBe(original.name);
    expect(result.updated.email).toBe(original.email);
    expect(result.updated.collegeId).toBe(original.collegeId);
    expect(result.updated.verifiedOn).toBe(original.verifiedOn);
  });

  it("leaves eligibility and status alone", async () => {
    const result = await updateProfile(student(), edit());
    if (!result.ok) throw new Error(result.error);
    const original = before.find((s) => s.id === result.updated.id)!;
    expect(result.updated.eligibility).toBe(original.eligibility);
    expect(result.updated.status).toBe(original.status);
    expect(result.updated.eligibilityDeterminedOn).toBe(
      original.eligibilityDeterminedOn,
    );
  });

  it("does not count as a verification", async () => {
    // `saveStudent` takes a `verifiedBy`; passing one here would let a learner
    // verify themselves by editing their own interests.
    const result = await updateProfile(student(), edit());
    if (!result.ok) throw new Error(result.error);
    const original = before.find((s) => s.id === result.updated.id)!;
    expect(result.updated.verifiedOn).toBe(original.verifiedOn);
  });
});

describe("what it does change", () => {
  it("saves the fields a match is scored on", async () => {
    const result = await updateProfile(
      student(),
      edit({ programOfStudy: "Welding Technology", availableHoursPerWeek: 22 }),
    );
    if (!result.ok) throw new Error(result.error);
    expect(result.updated.programOfStudy).toBe("Welding Technology");
    expect(result.updated.availableHoursPerWeek).toBe(22);
    expect(seed.students.find((s) => s.id === result.updated.id)!.programOfStudy).toBe(
      "Welding Technology",
    );
  });

  it("records the edit in the audit log", async () => {
    await updateProfile(student(), edit());
    const entry = seed.auditEvents.find((e) => e.to === "profile_updated");
    expect(entry?.actorRole).toBe("student");
    expect(entry?.entityType).toBe("student");
  });
});

describe("tags", () => {
  it("trims, drops blanks, and de-duplicates without regard to case", async () => {
    // Match scoring compares tags literally, so "Welding" and "welding" are
    // two skills to the scorer and one skill to a person.
    const result = await updateProfile(
      student(),
      edit({ skills: ["  Welding ", "welding", "", "   ", "Rigging"] }),
    );
    if (!result.ok) throw new Error(result.error);
    expect(result.updated.skills).toEqual(["Welding", "Rigging"]);
  });

  it("caps the list rather than refusing it", async () => {
    // A profile with forty skills is not a better match, it is a worse one.
    // Truncating is kinder than an error about a limit nobody was told.
    const many = Array.from({ length: MAX_TAGS + 5 }, (_, i) => `Skill ${i}`);
    const result = await updateProfile(student(), edit({ skills: many }));
    if (!result.ok) throw new Error(result.error);
    expect(result.updated.skills).toHaveLength(MAX_TAGS);
  });

  it("drops a tag long enough to be an essay", async () => {
    const result = await updateProfile(
      student(),
      edit({ skills: ["Welding", "x".repeat(200)] }),
    );
    if (!result.ok) throw new Error(result.error);
    expect(result.updated.skills).toEqual(["Welding"]);
  });
});

describe("what it refuses", () => {
  it.each([0, -1, MAX_HOURS_PER_WEEK + 1, 12.5])(
    "refuses %o available hours",
    async (hours) => {
      const result = await updateProfile(
        student(),
        edit({ availableHoursPerWeek: hours }),
      );
      expect(result.ok).toBe(false);
    },
  );

  it.each(["", " ", "x"])("refuses %o as a programme of study", async (value) => {
    const result = await updateProfile(student(), edit({ programOfStudy: value }));
    expect(result.ok).toBe(false);
  });

  it("refuses a record whose identifiers have been purged", async () => {
    // There is nothing left to edit, and writing to it would be writing to a
    // record the retention schedule has already closed.
    const target = seed.students.find((s) => s.userId === student().user.id)!;
    const at = seed.students.findIndex((s) => s.id === target.id);
    seed.students[at] = { ...target, purgedOn: "2030-01-01" };

    const result = await updateProfile(student(), edit());
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/purged/i);
  });
});
