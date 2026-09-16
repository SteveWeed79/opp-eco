import { describe, it, expect, afterEach } from "vitest";
import { publishInterviewSlots, MAX_SLOT_LEAD_DAYS } from "./creation";
import { contextFor } from "@/data/session";
import * as seed from "@/data/seed";

/**
 * Publishing interview slots.
 *
 * The eligibility interview is the step every subsidised placement waits on,
 * and until this existed the board could only offer times somebody had written
 * into the fixtures. The button for it was on screen the whole time, doing
 * nothing.
 *
 * These write to the shared seed array, so each test clears what it added.
 */

afterEach(() => {
  seed.publishedSlots.length = 0;
  seed.slotOverrides.clear();
  // The audit log is shared too, and a stray entry changes counts other suites
  // assert on.
  for (let i = seed.auditEvents.length - 1; i >= 0; i--) {
    if (seed.auditEvents[i].entityType === "interview_slot") {
      seed.auditEvents.splice(i, 1);
    }
  }
});

const board = () => contextFor("board");
const soon = (days: number, hour = 9) => {
  const at = new Date();
  at.setUTCDate(at.getUTCDate() + days);
  at.setUTCHours(hour, 0, 0, 0);
  return at.toISOString();
};

const request = (overrides: Partial<Parameters<typeof publishInterviewSlots>[1]> = {}) => ({
  startsAt: [soon(7)],
  durationMinutes: 30,
  officerName: "M. Delgado",
  meetingUrl: null,
  ...overrides,
});

describe("who may publish", () => {
  it("is the board", async () => {
    const result = await publishInterviewSlots(board(), request());
    expect(result.ok).toBe(true);
  });

  it.each(["student", "college", "business", "admin"] as const)(
    "is not the %s, even the administrator",
    async (role) => {
      // The admin console is an oversight surface. Publishing a calendar on a
      // board's behalf would put a name on an appointment nobody at the board
      // agreed to sit.
      const result = await publishInterviewSlots(contextFor(role), request());
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.code).toBe("forbidden");
    },
  );
});

describe("a batch", () => {
  it("publishes a morning in one transaction", async () => {
    const result = await publishInterviewSlots(
      board(),
      request({ startsAt: [soon(7, 9), soon(7, 10), soon(7, 11)] }),
    );
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.created).toHaveLength(3);
    expect(seed.publishedSlots).toHaveLength(3);
  });

  it("writes nothing at all when one time is bad", async () => {
    // The reason it is a batch: a board must never end up with half a morning
    // published and no way to tell which half.
    const result = await publishInterviewSlots(
      board(),
      request({ startsAt: [soon(7, 9), "not-a-date", soon(7, 11)] }),
    );
    expect(result.ok).toBe(false);
    expect(seed.publishedSlots).toHaveLength(0);
  });

  it("opens each slot unbooked, which is what makes it bookable", async () => {
    const result = await publishInterviewSlots(board(), request());
    if (!result.ok) throw new Error(result.error);
    expect(result.created[0].bookedByStudentId).toBeNull();
    expect(result.created[0].bookedAt).toBeNull();
    expect(result.created[0].version).toBe(1);
  });

  it("records each one in the audit log", async () => {
    await publishInterviewSlots(board(), request({ startsAt: [soon(7, 9), soon(7, 10)] }));
    const entries = seed.auditEvents.filter((e) => e.entityType === "interview_slot");
    expect(entries).toHaveLength(2);
    expect(entries[0].to).toBe("open");
    expect(entries[0].actorRole).toBe("board");
  });
});

describe("times it refuses", () => {
  it("refuses the past, rather than publishing something nobody can book", async () => {
    const result = await publishInterviewSlots(
      board(),
      request({ startsAt: [soon(-1)] }),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/already passed/i);
  });

  it("refuses further out than anyone knows their calendar", async () => {
    const result = await publishInterviewSlots(
      board(),
      request({ startsAt: [soon(MAX_SLOT_LEAD_DAYS + 1)] }),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/days ahead/i);
  });

  it("refuses an empty list", async () => {
    const result = await publishInterviewSlots(board(), request({ startsAt: [] }));
    expect(result.ok).toBe(false);
  });

  it.each([0, 5, 121, 30.5])("refuses %o minutes", async (minutes) => {
    const result = await publishInterviewSlots(
      board(),
      request({ durationMinutes: minutes }),
    );
    expect(result.ok).toBe(false);
  });
});

describe("double-booking an officer", () => {
  it("refuses the same time twice within one batch", async () => {
    // The mistake a form makes easy: add-another-time, then not change it.
    const at = soon(7, 9);
    const result = await publishInterviewSlots(board(), request({ startsAt: [at, at] }));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/already published/i);
    expect(seed.publishedSlots).toHaveLength(0);
  });

  it("refuses a time that officer already has published", async () => {
    const at = soon(7, 9);
    expect((await publishInterviewSlots(board(), request({ startsAt: [at] }))).ok).toBe(true);
    const again = await publishInterviewSlots(board(), request({ startsAt: [at] }));
    expect(again.ok).toBe(false);
  });

  it("allows two officers at the same time, because they are two rooms", async () => {
    const at = soon(7, 9);
    expect((await publishInterviewSlots(board(), request({ startsAt: [at] }))).ok).toBe(true);
    const other = await publishInterviewSlots(
      board(),
      request({ startsAt: [at], officerName: "R. Okonkwo" }),
    );
    expect(other.ok).toBe(true);
  });
});

describe("what a published slot keeps", () => {
  it("keeps the time the board chose, while fixtures drift forward", async () => {
    // Seeded slots are regenerated relative to now so the demo never opens on
    // appointments that have already happened. A published slot is a real
    // appointment and must not move.
    const at = soon(7, 14);
    const result = await publishInterviewSlots(board(), request({ startsAt: [at] }));
    if (!result.ok) throw new Error(result.error);

    const laterToday = seed.interviewSlotsAt(new Date(Date.now() + 3_600_000));
    expect(laterToday.find((s) => s.id === result.created[0].id)?.startsAt).toBe(at);
  });

  it("appears alongside the seeded ones, so a student can book it", async () => {
    const result = await publishInterviewSlots(board(), request());
    if (!result.ok) throw new Error(result.error);
    const all = seed.interviewSlotsAt();
    expect(all.some((s) => s.id === result.created[0].id)).toBe(true);
    expect(all.length).toBeGreaterThan(1);
  });

  it("refuses a meeting link that is not a link", async () => {
    // Trimmed to null rather than stored: an empty string in a URL field
    // renders as a broken link on the student's page.
    const result = await publishInterviewSlots(board(), request({ meetingUrl: "   " }));
    if (!result.ok) throw new Error(result.error);
    expect(result.created[0].meetingUrl).toBeNull();
  });
});
