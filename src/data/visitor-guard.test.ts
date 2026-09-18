/**
 * The write every anonymous visitor does not get to make.
 *
 * Its own file because it has to mock `@/auth/visitor`, and mocking is
 * module-wide. The flag it mocks is genuinely request-scoped — React's `cache`
 * hands a fresh object to anything running outside a request — so a test cannot
 * set it for real, and a guard nothing exercises is a guard nobody notices
 * losing.
 */

import { describe, it, expect, vi } from "vitest";

vi.mock("@/auth/visitor", () => ({
  isAnonymousVisitor: () => true,
  markAnonymousVisitor: () => {},
}));

const { store, VisitorError } = await import("./backend");

describe("the store refuses an anonymous visitor", () => {
  it("throws before any unit of work is assembled", async () => {
    let assembled = false;
    await expect(
      store.transaction(async () => {
        assembled = true;
        return "written";
      }),
    ).rejects.toThrow(VisitorError);
    // The point of putting this in the store rather than in the actions: the
    // refusal happens before a connection is taken and before the caller's work
    // runs at all, so there is no half-applied anything to undo.
    expect(assembled).toBe(false);
  });
});
